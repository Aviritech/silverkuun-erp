-- Clients brought in by any staff member (sosa, 16 November 2026):
--
--   1. "Send to staff" replaces "Send to marketer". Any staff member can bring in a client, so the officer names the
--      person who brought the client in, and only that person confirms the file. Their id is kept on the member as
--      introduced_by. Files sent the old way (no named person) can still be confirmed by a branch marketer.
--
--   2. Sign-up links. A staff member creates a one-time link (valid 1 to 7 days) and sends it to the client, who fills
--      the member form and uploads their documents without logging in. The file then goes to the staff member who
--      made the link, then the Operations Officer, then the Branch Manager:
--
--        client fills the form ──▶ with_marketer (the link's owner confirms) ──▶ marketer_reviewed (officer completes)
--          ──▶ pending_approval (Branch Manager) ──▶ approved
--
--      Only a SHA-256 hash of the link's token is stored. The public page talks to the database only through the
--      service-role functions below (never as anon), and client files go to a private bucket that has no policies:
--      the server issues one signed upload URL per file, then checks and moves each file into the member's folder.
--
--   3. "My clients": every staff member sees the members they brought in, with each member's total contributions.

-- ===========================================================================
-- 1. Who brought the client in
-- ===========================================================================

alter table public.members
  add column introduced_by uuid references public.staff (id),
  add column source text not null default 'staff' check (source in ('staff', 'self_signup'));
create index members_introduced_by_idx on public.members (introduced_by) where introduced_by is not null;

comment on column public.members.introduced_by is 'The staff member who brought the client in and confirms the file (any department).';
comment on column public.members.source is 'staff: an officer typed the file in; self_signup: the client filled it through a sign-up link.';

-- Like the marketer's review, these are written only by the workflow functions.
create or replace function app.members_marketer_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if app.in_workflow() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.sent_to_marketer_by := null;
    new.sent_to_marketer_at := null;
    new.marketer_id := null;
    new.marketer_reviewed_at := null;
    new.marketer_note := null;
    new.returned_by := null;
    new.introduced_by := null;
    new.source := 'staff';
  elsif new.sent_to_marketer_by is distinct from old.sent_to_marketer_by
     or new.sent_to_marketer_at is distinct from old.sent_to_marketer_at
     or new.marketer_id is distinct from old.marketer_id
     or new.marketer_reviewed_at is distinct from old.marketer_reviewed_at
     or new.marketer_note is distinct from old.marketer_note
     or new.returned_by is distinct from old.returned_by
     or new.introduced_by is distinct from old.introduced_by
     or new.source is distinct from old.source then
    raise exception 'who brought the client in, and their confirmation, are recorded only through the approval workflow'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

-- Existing files: the marketer who confirmed a member is the one who knew them, so they start as its introducer.
-- This gives marketers their "My clients" list straight away.
select app.begin_workflow();
update public.members set introduced_by = marketer_id where marketer_id is not null and introduced_by is null;
select app.end_workflow();

-- The person who brought a client in can read that client's file (to confirm it, and to follow it in "My clients").
create policy "staff see the clients they brought in" on public.members for select to authenticated
  using (introduced_by = auth.uid());

-- Active staff an officer can name as the person who brought the client in. Names and departments only.
create or replace function public.member_introducer_options()
returns table (id uuid, full_name text, department text)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.full_name, d.name
  from public.staff s
  join public.departments d on d.code = s.department_code
  where s.is_active
    and app.has_permission('members.manage')
  order by s.full_name;
$$;

-- Step 1 (staff-typed files): the officer sends a draft or returned file to the staff member who brought the client in.
create or replace function public.send_member_to_staff(p_member_id uuid, p_staff_id uuid)
returns public.members
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.members;
begin
  select * into v_member from public.members where id = p_member_id for update;
  if not found or not app.has_branch_permission('members.manage', v_member.branch_id) then
    raise exception 'member not found' using errcode = 'no_data_found';
  end if;
  if v_member.status not in ('draft', 'returned') then
    raise exception 'only draft or returned files can be sent to staff' using errcode = 'check_violation';
  end if;
  if p_staff_id is null or not exists (select 1 from public.staff s where s.id = p_staff_id and s.is_active) then
    raise exception 'choose the staff member who brought this client in' using errcode = 'check_violation';
  end if;
  if p_staff_id = auth.uid() then
    raise exception 'you are preparing this file, so you can''t also confirm it; ask another officer to send it'
      using errcode = 'insufficient_privilege';
  end if;
  if v_member.source = 'staff' and p_staff_id = v_member.created_by then
    raise exception 'the staff member who started this file can''t also confirm it' using errcode = 'insufficient_privilege';
  end if;

  perform app.begin_workflow();
  update public.members
     set status = 'with_marketer', introduced_by = p_staff_id,
         sent_to_marketer_by = auth.uid(), sent_to_marketer_at = now(),
         marketer_id = null, marketer_reviewed_at = null, marketer_note = null,
         submitted_by = null, submitted_at = null, return_reason = null, returned_by = null
   where id = p_member_id
   returning * into v_member;
  perform app.end_workflow();
  return v_member;
end;
$$;

-- True when the signed-in staff member is the one who confirms this file at the "with staff" step.
create or replace function app.can_confirm_member(v_member public.members)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when v_member.introduced_by is not null then v_member.introduced_by = auth.uid()
    -- Files sent before this change, with no named person: any branch marketer except whoever prepared it.
    else app.has_branch_permission('members.endorse', v_member.branch_id)
         and auth.uid() is distinct from v_member.created_by
  end
  and auth.uid() is distinct from v_member.sent_to_marketer_by
  and exists (select 1 from public.staff s where s.id = auth.uid() and s.is_active);
$$;

-- Step 2: the staff member who brought the client in confirms they know them, and the file goes to the officer.
create or replace function public.marketer_review_member(p_member_id uuid, p_note text)
returns public.members
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.members;
begin
  select * into v_member from public.members where id = p_member_id for update;
  if not found or not (app.can_confirm_member(v_member)
                       or app.has_branch_permission('members.read', v_member.branch_id)
                       or v_member.introduced_by = auth.uid()) then
    raise exception 'member not found' using errcode = 'no_data_found';
  end if;
  if v_member.status <> 'with_marketer' then
    raise exception 'only files waiting for staff confirmation can be confirmed' using errcode = 'check_violation';
  end if;
  if not app.can_confirm_member(v_member) then
    if v_member.introduced_by is null and auth.uid() in (v_member.created_by, v_member.sent_to_marketer_by) then
      raise exception 'you prepared this file, so another marketer must review it' using errcode = 'insufficient_privilege';
    end if;
    raise exception 'only the staff member who brought this client in can confirm the file' using errcode = 'insufficient_privilege';
  end if;

  perform app.begin_workflow();
  update public.members
     set status = 'marketer_reviewed', marketer_id = auth.uid(), marketer_reviewed_at = now(),
         marketer_note = nullif(trim(p_note), '')
   where id = p_member_id
   returning * into v_member;
  perform app.end_workflow();
  return v_member;
end;
$$;

-- The confirming staff member (while confirming) or the Branch Manager (while approving) sends the file back to the
-- officer. A client's own sign-up that the staff member doesn't recognise goes back the same way.
create or replace function public.return_member(p_member_id uuid, p_reason text)
returns public.members
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.members;
begin
  select * into v_member from public.members where id = p_member_id for update;
  if not found then
    raise exception 'member not found' using errcode = 'no_data_found';
  end if;
  if v_member.status = 'with_marketer' then
    if not app.can_confirm_member(v_member) then
      if app.has_branch_permission('members.read', v_member.branch_id) or v_member.introduced_by = auth.uid() then
        raise exception 'you prepared this file, so someone else must review it' using errcode = 'insufficient_privilege';
      end if;
      raise exception 'member not found' using errcode = 'no_data_found';
    end if;
  elsif v_member.status = 'pending_approval' then
    if not app.has_branch_permission('members.approve', v_member.branch_id) then
      raise exception 'member not found' using errcode = 'no_data_found';
    end if;
    if auth.uid() in (v_member.created_by, v_member.submitted_by, v_member.sent_to_marketer_by) then
      raise exception 'you prepared this file, so someone else must review it' using errcode = 'insufficient_privilege';
    end if;
  else
    if not app.has_branch_permission('members.read', v_member.branch_id) then
      raise exception 'member not found' using errcode = 'no_data_found';
    end if;
    raise exception 'only files with staff or awaiting approval can be returned' using errcode = 'check_violation';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'say what needs correcting' using errcode = 'check_violation';
  end if;

  perform app.begin_workflow();
  update public.members
     set status = 'returned', return_reason = trim(p_reason), returned_by = auth.uid()
   where id = p_member_id
   returning * into v_member;
  perform app.end_workflow();
  return v_member;
end;
$$;

-- Step 3 is unchanged apart from its wording.
create or replace function public.submit_member(p_member_id uuid)
returns public.members
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.members;
  v_missing text[];
begin
  select * into v_member from public.members where id = p_member_id for update;
  if not found or not app.has_branch_permission('members.manage', v_member.branch_id) then
    raise exception 'member not found' using errcode = 'no_data_found';
  end if;
  if v_member.status in ('draft', 'returned') then
    raise exception 'send the file to the staff member who brought the client in first' using errcode = 'check_violation';
  end if;
  if v_member.status <> 'marketer_reviewed' then
    raise exception 'only files confirmed by staff can be sent to the Branch Manager' using errcode = 'check_violation';
  end if;

  select array_agg(required.t order by required.t) into v_missing
  from unnest(array['kyc_form', 'nin_slip', 'means_of_id', 'utility_bill']::public.member_document_type[]) as required(t)
  where not exists (
    select 1 from public.member_documents d where d.member_id = p_member_id and d.document_type = required.t
  );
  if v_missing is not null then
    raise exception 'missing required documents: %', array_to_string(v_missing, ', ') using errcode = 'check_violation';
  end if;

  perform app.begin_workflow();
  update public.members
     set status = 'pending_approval', submitted_by = auth.uid(), submitted_at = now(), return_reason = null
   where id = p_member_id
   returning * into v_member;
  perform app.end_workflow();
  return v_member;
end;
$$;

-- Locked-file messages now say "staff" rather than "the marketer".
create or replace function app.members_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.date_of_birth is not null and new.date_of_birth >= current_date then
      raise exception 'date of birth must be in the past' using errcode = 'check_violation';
    end if;
    if not app.in_workflow() then
      new.status := 'draft';
      new.membership_no := null;
      new.created_by := auth.uid();
      new.submitted_by := null;
      new.submitted_at := null;
      new.approved_by := null;
      new.approved_at := null;
      new.return_reason := null;
      new.amendment_reason := null;
    end if;
    return new;
  end if;

  if new.date_of_birth is not null and new.date_of_birth >= current_date then
    raise exception 'date of birth must be in the past' using errcode = 'check_violation';
  end if;

  new.updated_at := now();
  if app.in_workflow() then
    return new;
  end if;

  if new.status is distinct from old.status
     or new.membership_no is distinct from old.membership_no
     or new.branch_id is distinct from old.branch_id
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at
     or new.submitted_by is distinct from old.submitted_by
     or new.submitted_at is distinct from old.submitted_at
     or new.approved_by is distinct from old.approved_by
     or new.approved_at is distinct from old.approved_at
     or new.return_reason is distinct from old.return_reason then
    raise exception 'status and approval details change only through the approval workflow'
      using errcode = 'insufficient_privilege';
  end if;

  if old.status = 'pending_approval' then
    raise exception 'this file is with the Branch Manager and can''t be edited until it is returned'
      using errcode = 'check_violation';
  end if;
  if old.status = 'with_marketer' then
    raise exception 'this file is with the staff member who brought the client in and can''t be edited until they send it back'
      using errcode = 'check_violation';
  end if;

  if old.status = 'approved'
     and (new.amendment_reason is null
          or length(trim(new.amendment_reason)) = 0
          or new.amendment_reason is not distinct from old.amendment_reason) then
    raise exception 'changes to an approved member need a reason'
      using errcode = 'check_violation';
  end if;

  if old.status <> 'approved' then
    new.amendment_reason := old.amendment_reason;
  end if;

  return new;
end;
$$;

-- Unchanged, except for the wording, and that a client's own uploads keep the uploader the sign-up function names.
create or replace function app.member_documents_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.members;
begin
  select * into v_member from public.members where id = coalesce(new.member_id, old.member_id);

  if tg_op = 'DELETE' then
    if v_member.status not in ('draft', 'returned', 'marketer_reviewed') then
      raise exception 'documents can only be removed while the file is with the officer' using errcode = 'check_violation';
    end if;
    return old;
  end if;

  new.branch_id := v_member.branch_id;
  new.uploaded_by := case when app.in_workflow() and auth.uid() is null then new.uploaded_by else auth.uid() end;
  new.uploaded_at := now();

  if v_member.status = 'pending_approval' then
    raise exception 'this file is with the Branch Manager; documents can be added once it is returned' using errcode = 'check_violation';
  end if;
  if v_member.status = 'with_marketer' then
    raise exception 'this file is with the staff member who brought the client in; documents can be added once they send it back'
      using errcode = 'check_violation';
  end if;
  if new.storage_path not like v_member.branch_id::text || '/' || v_member.id::text || '/%' then
    raise exception 'storage path must sit under the member''s folder' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function public.member_introducer_options() from public, anon;
revoke all on function public.send_member_to_staff(uuid, uuid) from public, anon;
revoke all on function app.can_confirm_member(public.members) from public, anon;
grant execute on function public.member_introducer_options() to authenticated;
grant execute on function public.send_member_to_staff(uuid, uuid) to authenticated;
grant execute on function app.can_confirm_member(public.members) to authenticated;

-- ===========================================================================
-- 2. Sign-up links
-- ===========================================================================

create table public.member_signup_links (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  branch_id uuid not null references public.branches (id),
  created_by uuid not null default auth.uid() references public.staff (id),
  client_name text check (client_name is null or length(trim(client_name)) between 1 and 120),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  used_at timestamptz,
  member_id uuid unique references public.members (id),
  constraint member_signup_links_expiry check (expires_at > created_at and expires_at <= created_at + interval '7 days'),
  constraint member_signup_links_used check ((used_at is null) = (member_id is null))
);
create index member_signup_links_creator_idx on public.member_signup_links (created_by, created_at desc);

alter table public.members add column signup_link_id uuid unique references public.member_signup_links (id);

alter table public.member_signup_links enable row level security;
select app.enable_audit('public.member_signup_links');

-- Staff see their own links. Every change goes through the functions below.
create policy "staff see their own sign-up links" on public.member_signup_links for select to authenticated
  using (created_by = auth.uid());
revoke all on public.member_signup_links from anon, authenticated;
grant select on public.member_signup_links to authenticated;

-- Who has been hitting the public sign-up page: one row per attempt, read only by the service-role functions.
create table app.signup_attempts (
  key text not null,
  at timestamptz not null default now()
);
create index signup_attempts_key_idx on app.signup_attempts (key, at desc);
revoke all on app.signup_attempts from public, anon, authenticated;

-- Any active staff member creates a link for a branch. The server makes the token and sends only its hash.
create or replace function public.create_member_signup_link(p_token_hash text, p_branch_id uuid, p_client_name text, p_days int)
returns public.member_signup_links
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link public.member_signup_links;
begin
  if not exists (select 1 from public.staff s where s.id = auth.uid() and s.is_active) then
    raise exception 'only active staff can create sign-up links' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from public.branches b where b.id = p_branch_id and b.is_active) then
    raise exception 'choose the branch the client will join' using errcode = 'check_violation';
  end if;
  if p_days is null or p_days not between 1 and 7 then
    raise exception 'a link can last from 1 to 7 days' using errcode = 'check_violation';
  end if;
  -- Keeps a lost or misused login from minting links in bulk.
  if (select count(*) from public.member_signup_links l
       where l.created_by = auth.uid() and l.created_at > now() - interval '1 day') >= 30 then
    raise exception 'you have created 30 links in the last day; try again tomorrow' using errcode = 'check_violation';
  end if;

  insert into public.member_signup_links (token_hash, branch_id, created_by, client_name, expires_at)
  values (p_token_hash, p_branch_id, auth.uid(), nullif(trim(p_client_name), ''), now() + make_interval(days => p_days))
  returning * into v_link;
  return v_link;
end;
$$;

create or replace function public.revoke_member_signup_link(p_id uuid)
returns public.member_signup_links
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link public.member_signup_links;
begin
  update public.member_signup_links
     set revoked_at = now()
   where id = p_id and created_by = auth.uid() and used_at is null and revoked_at is null
   returning * into v_link;
  if not found then
    raise exception 'this link has already been used or switched off' using errcode = 'check_violation';
  end if;
  return v_link;
end;
$$;

-- Service role only: counts an attempt against `p_key` and says whether it is within `p_limit` per `p_window`.
create or replace function public.signup_rate_check(p_key text, p_limit int, p_window interval)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  delete from app.signup_attempts where at < now() - interval '1 day';
  select count(*) into v_count from app.signup_attempts where key = p_key and at > now() - p_window;
  if v_count >= p_limit then
    return false;
  end if;
  insert into app.signup_attempts (key) values (left(p_key, 200));
  return true;
end;
$$;

-- Service role only: what the public page needs to know about a link. Nothing when it doesn't exist.
create or replace function public.signup_link_status(p_token_hash text)
returns table (link_id uuid, branch_id uuid, branch_name text, staff_name text, client_name text, expires_at timestamptz, state text)
language sql
stable
security definer
set search_path = ''
as $$
  select l.id, l.branch_id, b.name, s.full_name, l.client_name, l.expires_at,
         case
           when l.used_at is not null then 'used'
           when l.revoked_at is not null then 'revoked'
           when l.expires_at <= now() then 'expired'
           when not s.is_active or not b.is_active then 'revoked'
           else 'open'
         end
  from public.member_signup_links l
  join public.branches b on b.id = l.branch_id
  join public.staff s on s.id = l.created_by
  where l.token_hash = p_token_hash;
$$;

-- Service role only: the client's form. Creates the member (with the id the server chose, so their files could be
-- placed in the member's folder first), records their documents, and puts the file with the link's owner.
create or replace function public.submit_member_signup(p_token_hash text, p_member_id uuid, p_member jsonb, p_documents jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link public.member_signup_links;
  v_doc jsonb;
begin
  select * into v_link from public.member_signup_links where token_hash = p_token_hash for update;
  if not found then
    raise exception 'this link is not valid' using errcode = 'no_data_found';
  end if;
  if v_link.used_at is not null or v_link.revoked_at is not null or v_link.expires_at <= now()
     or not exists (select 1 from public.staff s where s.id = v_link.created_by and s.is_active) then
    raise exception 'this link has expired or has already been used' using errcode = 'check_violation';
  end if;
  if jsonb_typeof(p_documents) is distinct from 'array' or jsonb_array_length(p_documents) > 8 then
    raise exception 'too many documents' using errcode = 'check_violation';
  end if;

  perform app.begin_workflow();

  insert into public.members (
    id, branch_id, status, created_by, introduced_by, source, signup_link_id,
    title, first_name, middle_name, last_name, date_of_birth, gender, phone, email,
    address, address_city, address_lga, address_state, address_landmark,
    nin, id_type, id_number, next_of_kin_name, next_of_kin_phone, next_of_kin_relationship,
    bank_code, bank_name, bank_account_no
  ) values (
    p_member_id, v_link.branch_id, 'draft', v_link.created_by, v_link.created_by, 'self_signup', v_link.id,
    p_member ->> 'title', p_member ->> 'first_name', p_member ->> 'middle_name', p_member ->> 'last_name',
    (p_member ->> 'date_of_birth')::date, p_member ->> 'gender', p_member ->> 'phone', p_member ->> 'email',
    p_member ->> 'address', p_member ->> 'address_city', p_member ->> 'address_lga', p_member ->> 'address_state',
    p_member ->> 'address_landmark',
    p_member ->> 'nin', p_member ->> 'id_type', p_member ->> 'id_number',
    p_member ->> 'next_of_kin_name', p_member ->> 'next_of_kin_phone', p_member ->> 'next_of_kin_relationship',
    p_member ->> 'bank_code', p_member ->> 'bank_name', p_member ->> 'bank_account_no'
  );

  -- Documents the client uploaded. The link's owner is recorded as the uploader; the file's source says it was the client.
  for v_doc in select * from jsonb_array_elements(p_documents) loop
    if v_doc ->> 'document_type' not in ('nin_slip', 'means_of_id', 'utility_bill', 'passport_photo') then
      raise exception 'clients can upload only their NIN slip, ID, utility bill and photo' using errcode = 'check_violation';
    end if;
    insert into public.member_documents (member_id, branch_id, document_type, file_name, storage_path, mime_type, size_bytes, uploaded_by)
    values (p_member_id, v_link.branch_id, (v_doc ->> 'document_type')::public.member_document_type, v_doc ->> 'file_name',
            v_doc ->> 'storage_path', v_doc ->> 'mime_type', (v_doc ->> 'size_bytes')::bigint, v_link.created_by);
  end loop;

  update public.members
     set status = 'with_marketer', sent_to_marketer_at = now()
   where id = p_member_id;

  update public.member_signup_links set used_at = now(), member_id = p_member_id where id = v_link.id;

  perform app.end_workflow();
  return p_member_id;
end;
$$;

revoke all on function public.create_member_signup_link(text, uuid, text, int) from public, anon;
revoke all on function public.revoke_member_signup_link(uuid) from public, anon;
revoke all on function public.signup_rate_check(text, int, interval) from public, anon, authenticated;
revoke all on function public.signup_link_status(text) from public, anon, authenticated;
revoke all on function public.submit_member_signup(text, uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.create_member_signup_link(text, uuid, text, int) to authenticated;
grant execute on function public.revoke_member_signup_link(uuid) to authenticated;
grant execute on function public.signup_rate_check(text, int, interval) to service_role;
grant execute on function public.signup_link_status(text) to service_role;
grant execute on function public.submit_member_signup(text, uuid, jsonb, jsonb) to service_role;

-- Clients' files land here through signed upload URLs only. No policies: nobody but the service role reads or writes
-- it, and the server moves each checked file into the member-documents bucket.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('signup-uploads', 'signup-uploads', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;

-- ===========================================================================
-- 3. My clients
-- ===========================================================================

-- The members the signed-in staff member brought in, with what each has paid in. Their own clients only.
create or replace function public.my_clients()
returns table (
  member_id uuid, membership_no text, full_name text, phone text, status public.member_status, source text,
  branch_name text, joined_on date, open_plans int, total_contributed numeric, total_verified numeric,
  paid_this_month numeric, last_paid_on date
)
language sql
stable
security definer
set search_path = ''
as $$
  select m.id, m.membership_no, concat_ws(' ', m.first_name, m.middle_name, m.last_name), m.phone, m.status, m.source,
         b.name, coalesce(m.approved_at, m.created_at)::date,
         (select count(*)::int from public.member_plans p where p.member_id = m.id and p.status = 'active'),
         coalesce(sum(c.amount), 0)::numeric(14, 2),
         coalesce(sum(c.amount) filter (where c.verified_at is not null), 0)::numeric(14, 2),
         coalesce(sum(c.amount) filter (where c.paid_on >= date_trunc('month', current_date)), 0)::numeric(14, 2),
         max(c.paid_on) filter (where c.kind <> 'reversal')
  from public.members m
  join public.branches b on b.id = m.branch_id
  left join public.contributions c on c.member_id = m.id
  where m.introduced_by = auth.uid()
  group by m.id, b.name;
$$;

revoke all on function public.my_clients() from public, anon;
grant execute on function public.my_clients() to authenticated;
