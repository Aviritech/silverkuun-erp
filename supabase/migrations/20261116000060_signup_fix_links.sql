-- Clients fix their own returned sign-up files (sosa, 16 November 2026).
--
-- A client who filled in their file through a sign-up link had no way back in once staff returned it: the link was
-- single use and the client has no login. Now, while a client's own file is returned, the staff member who brought
-- them in (or an Operations Officer for the branch) can create a one-time "fix" link. It opens the client's form with
-- their earlier answers and the reason it came back; the client corrects it, may replace documents, and sends it.
-- The file then starts the chain again, as a new sign-up does:
--
--   returned ──(client fixes through the link)──▶ with_marketer (the staff member who brought them in confirms)
--     ──▶ marketer_reviewed (officer completes) ──▶ pending_approval (Branch Manager) ──▶ approved
--
-- Staff can still correct the file themselves and send it on as before; doing so switches off any open fix link.
-- As with sign-up links, only a SHA-256 hash of the token is kept, the public page reaches the database only through
-- the service-role functions below, and client files go through the private signup-uploads bucket.

create table public.member_fix_links (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  member_id uuid not null references public.members (id),
  created_by uuid not null default auth.uid() references public.staff (id),
  -- The reason the client sees, copied when the link is made so a later return can't change what this link says.
  return_reason text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  used_at timestamptz,
  constraint member_fix_links_expiry check (expires_at > created_at and expires_at <= created_at + interval '7 days')
);
create index member_fix_links_member_idx on public.member_fix_links (member_id, created_at desc);
create index member_fix_links_creator_idx on public.member_fix_links (created_by, created_at desc);

alter table public.member_fix_links enable row level security;
select app.enable_audit('public.member_fix_links');

-- Staff see the fix links on files they can read, so the member page can say one is waiting with the client.
create policy "staff see fix links on files they can read" on public.member_fix_links for select to authenticated
  using (exists (select 1 from public.members m where m.id = member_id));
revoke all on public.member_fix_links from anon, authenticated;
grant select (id, member_id, created_by, created_at, expires_at, revoked_at, used_at) on public.member_fix_links to authenticated;

-- Who may send the client a fix link: the staff member who brought them in, or an officer who manages the branch.
create or replace function app.can_send_fix_link(v_member public.members)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select v_member.source = 'self_signup'
     and v_member.status = 'returned'
     and exists (select 1 from public.staff s where s.id = auth.uid() and s.is_active)
     and (v_member.introduced_by = auth.uid() or app.has_branch_permission('members.manage', v_member.branch_id));
$$;

-- Creates a fix link. The server makes the token and sends only its hash. Any earlier open link for the file closes.
create or replace function public.create_member_fix_link(p_token_hash text, p_member_id uuid, p_days int)
returns public.member_fix_links
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.members;
  v_link public.member_fix_links;
begin
  select * into v_member from public.members where id = p_member_id for update;
  if not found or not (v_member.introduced_by = auth.uid() or app.has_branch_permission('members.read', v_member.branch_id)) then
    raise exception 'member not found' using errcode = 'no_data_found';
  end if;
  if v_member.source <> 'self_signup' then
    raise exception 'only files the client filled in themselves can be sent back to the client' using errcode = 'check_violation';
  end if;
  if v_member.status <> 'returned' then
    raise exception 'only returned files can be sent to the client to fix' using errcode = 'check_violation';
  end if;
  if not app.can_send_fix_link(v_member) then
    raise exception 'only the staff member who brought this client in, or an officer at the branch, can send it to the client'
      using errcode = 'insufficient_privilege';
  end if;
  if p_days is null or p_days not between 1 and 7 then
    raise exception 'a link can last from 1 to 7 days' using errcode = 'check_violation';
  end if;
  if (select count(*) from public.member_fix_links l
       where l.created_by = auth.uid() and l.created_at > now() - interval '1 day') >= 30 then
    raise exception 'you have created 30 links in the last day; try again tomorrow' using errcode = 'check_violation';
  end if;

  update public.member_fix_links set revoked_at = now()
   where member_id = p_member_id and used_at is null and revoked_at is null;

  insert into public.member_fix_links (token_hash, member_id, created_by, return_reason, expires_at)
  values (p_token_hash, p_member_id, auth.uid(), coalesce(nullif(trim(v_member.return_reason), ''), 'Please check your details.'),
          now() + make_interval(days => p_days))
  returning * into v_link;
  return v_link;
end;
$$;

create or replace function public.revoke_member_fix_link(p_id uuid)
returns public.member_fix_links
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link public.member_fix_links;
  v_member public.members;
begin
  select * into v_link from public.member_fix_links where id = p_id for update;
  if found then
    select * into v_member from public.members where id = v_link.member_id;
  end if;
  if not found or v_link.used_at is not null or v_link.revoked_at is not null
     or not (v_link.created_by = auth.uid() or v_member.introduced_by = auth.uid()
             or app.has_branch_permission('members.manage', v_member.branch_id)) then
    raise exception 'this link has already been used or switched off' using errcode = 'check_violation';
  end if;
  update public.member_fix_links set revoked_at = now() where id = p_id returning * into v_link;
  return v_link;
end;
$$;

-- Once a returned file moves on (an officer corrected it and sent it, or the client fixed it), open links close.
create or replace function app.close_fix_links_after_return()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'returned' and new.status <> 'returned' then
    update public.member_fix_links set revoked_at = now()
     where member_id = new.id and used_at is null and revoked_at is null;
  end if;
  return null;
end;
$$;

create trigger members_close_fix_links
  after update of status on public.members
  for each row execute function app.close_fix_links_after_return();

-- Service role only: what the public page needs for a fix link, with the client's current answers. Nothing when the
-- link doesn't exist. Documents are listed by type and name only; their files are never served on the public page.
create or replace function public.member_fix_link_status(p_token_hash text)
returns table (
  link_id uuid, member_id uuid, branch_id uuid, branch_name text, staff_name text, expires_at timestamptz,
  return_reason text, state text, member jsonb, documents jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select l.id, m.id, m.branch_id, b.name, s.full_name, l.expires_at, l.return_reason,
         case
           when l.used_at is not null then 'used'
           when l.revoked_at is not null then 'revoked'
           when l.expires_at <= now() then 'expired'
           when m.status <> 'returned' or not s.is_active or not b.is_active then 'revoked'
           else 'open'
         end,
         case when l.used_at is null and l.revoked_at is null and l.expires_at > now() and m.status = 'returned' then
           jsonb_build_object(
             'title', m.title, 'first_name', m.first_name, 'middle_name', m.middle_name, 'last_name', m.last_name,
             'date_of_birth', m.date_of_birth, 'gender', m.gender, 'phone', m.phone, 'email', m.email,
             'address', m.address, 'address_city', m.address_city, 'address_lga', m.address_lga,
             'address_state', m.address_state, 'address_landmark', m.address_landmark,
             'nin', m.nin, 'id_type', m.id_type, 'id_number', m.id_number,
             'next_of_kin_name', m.next_of_kin_name, 'next_of_kin_phone', m.next_of_kin_phone,
             'next_of_kin_relationship', m.next_of_kin_relationship,
             'bank_code', m.bank_code, 'bank_name', m.bank_name, 'bank_account_no', m.bank_account_no
           )
         end,
         case when l.used_at is null and l.revoked_at is null and l.expires_at > now() and m.status = 'returned' then
           coalesce((select jsonb_agg(jsonb_build_object('document_type', d.document_type, 'file_name', d.file_name)
                                      order by d.uploaded_at)
                     from public.member_documents d where d.member_id = m.id), '[]'::jsonb)
         end
  from public.member_fix_links l
  join public.members m on m.id = l.member_id
  join public.branches b on b.id = m.branch_id
  join public.staff s on s.id = l.created_by
  where l.token_hash = p_token_hash;
$$;

-- Service role only: the client's corrected form. Updates their details, replaces any documents they chose again
-- (returning the replaced files' paths so the server can delete them), and sends the file back to the staff member
-- who brought them in.
create or replace function public.submit_member_fix(p_token_hash text, p_member jsonb, p_documents jsonb)
returns table (removed_path text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link public.member_fix_links;
  v_member public.members;
  v_doc jsonb;
  v_removed text[] := '{}';
  v_paths text[];
begin
  select * into v_link from public.member_fix_links where token_hash = p_token_hash for update;
  if not found then
    raise exception 'this link is not valid' using errcode = 'no_data_found';
  end if;
  select * into v_member from public.members where id = v_link.member_id for update;
  if v_link.used_at is not null or v_link.revoked_at is not null or v_link.expires_at <= now()
     or v_member.status <> 'returned'
     or not exists (select 1 from public.staff s where s.id = v_link.created_by and s.is_active) then
    raise exception 'this link has expired or has already been used' using errcode = 'check_violation';
  end if;
  if jsonb_typeof(p_documents) is distinct from 'array' or jsonb_array_length(p_documents) > 8 then
    raise exception 'too many documents' using errcode = 'check_violation';
  end if;

  perform app.begin_workflow();

  update public.members set
    title = p_member ->> 'title', first_name = p_member ->> 'first_name', middle_name = p_member ->> 'middle_name',
    last_name = p_member ->> 'last_name', date_of_birth = (p_member ->> 'date_of_birth')::date,
    gender = p_member ->> 'gender', phone = p_member ->> 'phone', email = p_member ->> 'email',
    address = p_member ->> 'address', address_city = p_member ->> 'address_city', address_lga = p_member ->> 'address_lga',
    address_state = p_member ->> 'address_state', address_landmark = p_member ->> 'address_landmark',
    nin = p_member ->> 'nin', id_type = p_member ->> 'id_type', id_number = p_member ->> 'id_number',
    next_of_kin_name = p_member ->> 'next_of_kin_name', next_of_kin_phone = p_member ->> 'next_of_kin_phone',
    next_of_kin_relationship = p_member ->> 'next_of_kin_relationship',
    bank_code = p_member ->> 'bank_code', bank_name = p_member ->> 'bank_name', bank_account_no = p_member ->> 'bank_account_no'
  where id = v_member.id;

  for v_doc in select * from jsonb_array_elements(p_documents) loop
    if v_doc ->> 'document_type' not in ('nin_slip', 'means_of_id', 'utility_bill', 'passport_photo') then
      raise exception 'clients can upload only their NIN slip, ID, utility bill and photo' using errcode = 'check_violation';
    end if;
    -- A new file replaces the one of the same type already on the file.
    with gone as (
      delete from public.member_documents d
       where d.member_id = v_member.id and d.document_type = (v_doc ->> 'document_type')::public.member_document_type
      returning d.storage_path
    )
    select coalesce(array_agg(storage_path), '{}') into v_paths from gone;
    v_removed := v_removed || v_paths;
    insert into public.member_documents (member_id, branch_id, document_type, file_name, storage_path, mime_type, size_bytes, uploaded_by)
    values (v_member.id, v_member.branch_id, (v_doc ->> 'document_type')::public.member_document_type, v_doc ->> 'file_name',
            v_doc ->> 'storage_path', v_doc ->> 'mime_type', (v_doc ->> 'size_bytes')::bigint, v_link.created_by);
  end loop;

  -- Marked used first, so the trigger that closes open links on this file leaves this one as used.
  update public.member_fix_links set used_at = now() where id = v_link.id;

  -- Back to the staff member who brought the client in, as a new sign-up goes. The reason is kept in the audit log.
  update public.members
     set status = 'with_marketer', sent_to_marketer_by = null, sent_to_marketer_at = now(),
         marketer_id = null, marketer_reviewed_at = null, marketer_note = null,
         submitted_by = null, submitted_at = null, return_reason = null, returned_by = null
   where id = v_member.id;

  perform app.end_workflow();
  return query select unnest(v_removed);
end;
$$;

revoke all on function app.can_send_fix_link(public.members) from public, anon;
revoke all on function public.create_member_fix_link(text, uuid, int) from public, anon;
revoke all on function public.revoke_member_fix_link(uuid) from public, anon;
revoke all on function public.member_fix_link_status(text) from public, anon, authenticated;
revoke all on function public.submit_member_fix(text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function app.can_send_fix_link(public.members) to authenticated;
grant execute on function public.create_member_fix_link(text, uuid, int) to authenticated;
grant execute on function public.revoke_member_fix_link(uuid) to authenticated;
grant execute on function public.member_fix_link_status(text) to service_role;
grant execute on function public.submit_member_fix(text, jsonb, jsonb) to service_role;
