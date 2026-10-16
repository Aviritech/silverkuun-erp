-- Administration: member onboarding, KYC documents, Branch Manager approval, plans and contributions.
--
-- Workflow (from the Administration requirements guide)
--   draft ──submit──▶ pending_approval ──approve──▶ approved (membership number issued)
--     ▲                     │
--     └──── returned ◀──return (with reason)
--
--   * Status and approval fields change only through submit_member / approve_member / return_member.
--   * A file can't be submitted until the KYC form, NIN slip, means of ID and utility bill are uploaded.
--   * The person who prepared or submitted a file can never approve it.
--   * Approved records can be corrected only by holders of members.amend, and every correction needs a reason.
--   * Contributions are a ledger: never edited or deleted. Mistakes are corrected with a reversal entry.

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------

insert into public.permissions (code, description) values
  ('members.read', 'View member profiles, documents, plans and contributions'),
  ('members.manage', 'Create member files, upload documents, submit files and add plans'),
  ('members.approve', 'Approve or return member files (Branch Manager)'),
  ('members.amend', 'Correct an approved member record, giving a reason'),
  ('contributions.record', 'Record contributions, top-ups and reversals'),
  ('contributions.verify', 'Verify recorded payments');

insert into public.role_permissions (role_code, permission_code) values
  ('admin_officer', 'members.read'),
  ('admin_officer', 'members.manage'),
  ('admin_officer', 'contributions.record'),
  ('branch_manager', 'members.read'),
  ('branch_manager', 'members.approve'),
  ('branch_manager', 'contributions.verify'),
  ('head_of_administration', 'members.read'),
  ('head_of_administration', 'members.amend'),
  ('head_of_administration', 'contributions.verify'),
  -- Auditors open the Administration module read-only so they can inspect member files.
  ('internal_auditor', 'module.administration'),
  ('internal_auditor', 'members.read');

-- ---------------------------------------------------------------------------
-- Workflow guard: lets the workflow functions below change protected columns
-- ---------------------------------------------------------------------------

create or replace function app.in_workflow()
returns boolean
language sql
stable
as $$
  select coalesce(current_setting('app.workflow', true), '') = 'on';
$$;

create or replace function app.begin_workflow()
returns void
language sql
as $$
  select set_config('app.workflow', 'on', true);
$$;

create or replace function app.end_workflow()
returns void
language sql
as $$
  select set_config('app.workflow', 'off', true);
$$;

revoke all on function app.begin_workflow() from public, anon, authenticated;
revoke all on function app.end_workflow() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Members
-- ---------------------------------------------------------------------------

create type public.member_status as enum ('draft', 'pending_approval', 'returned', 'approved');

create sequence public.membership_number_seq;

create table public.members (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches (id) on delete restrict,
  membership_no text unique,
  status public.member_status not null default 'draft',

  title text,
  first_name text not null check (length(trim(first_name)) > 0),
  middle_name text,
  last_name text not null check (length(trim(last_name)) > 0),
  date_of_birth date,
  gender text check (gender in ('female', 'male')),
  phone text not null check (length(trim(phone)) >= 7),
  email text check (email is null or email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  address text not null check (length(trim(address)) > 0),
  nin text not null unique check (nin ~ '^[0-9]{11}$'),
  id_type text not null check (id_type in ('national_id', 'drivers_licence', 'international_passport', 'voters_card')),
  id_number text not null check (length(trim(id_number)) > 0),
  next_of_kin_name text,
  next_of_kin_phone text,
  next_of_kin_relationship text,

  return_reason text,
  amendment_reason text,

  created_by uuid not null default auth.uid() references public.staff (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  submitted_by uuid references public.staff (id),
  submitted_at timestamptz,
  approved_by uuid references public.staff (id),
  approved_at timestamptz
);
create index members_branch_status_idx on public.members (branch_id, status);
create index members_name_idx on public.members (lower(last_name), lower(first_name));

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

create trigger members_guard
  before insert or update on public.members
  for each row execute function app.members_guard();

select app.enable_audit('public.members');

alter table public.members enable row level security;

create policy "member readers see their branches' members" on public.members for select to authenticated
  using (app.has_branch_permission('members.read', branch_id));

create policy "member managers create draft files" on public.members for insert to authenticated
  with check (app.has_branch_permission('members.manage', branch_id));

create policy "member managers edit unapproved files" on public.members for update to authenticated
  using (status in ('draft', 'returned') and app.has_branch_permission('members.manage', branch_id))
  with check (app.has_branch_permission('members.manage', branch_id));

create policy "amenders correct approved members" on public.members for update to authenticated
  using (status = 'approved' and app.has_branch_permission('members.amend', branch_id))
  with check (app.has_branch_permission('members.amend', branch_id));
-- No delete policy: member records are never deleted.

-- ---------------------------------------------------------------------------
-- Member documents (files live in the private "member-documents" storage bucket)
-- ---------------------------------------------------------------------------

create type public.member_document_type as enum (
  'kyc_form', 'nin_slip', 'means_of_id', 'utility_bill', 'passport_photo', 'signed_agreement_letter', 'other'
);

create table public.member_documents (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members (id) on delete restrict,
  branch_id uuid not null references public.branches (id),
  document_type public.member_document_type not null,
  file_name text not null,
  storage_path text not null unique,
  mime_type text not null check (mime_type in ('application/pdf', 'image/jpeg', 'image/png')),
  size_bytes integer not null check (size_bytes > 0 and size_bytes <= 10485760),
  uploaded_by uuid not null default auth.uid() references public.staff (id),
  uploaded_at timestamptz not null default now()
);
create index member_documents_member_idx on public.member_documents (member_id);

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
    if v_member.status not in ('draft', 'returned') then
      raise exception 'documents can only be removed while the file is a draft or returned' using errcode = 'check_violation';
    end if;
    return old;
  end if;

  new.branch_id := v_member.branch_id;
  new.uploaded_by := auth.uid();
  new.uploaded_at := now();

  if v_member.status = 'pending_approval' then
    raise exception 'this file is with the Branch Manager; documents can be added once it is returned' using errcode = 'check_violation';
  end if;
  if new.storage_path not like v_member.branch_id::text || '/' || v_member.id::text || '/%' then
    raise exception 'storage path must sit under the member''s folder' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger member_documents_guard
  before insert or delete on public.member_documents
  for each row execute function app.member_documents_guard();

select app.enable_audit('public.member_documents');

alter table public.member_documents enable row level security;

create policy "member readers see documents" on public.member_documents for select to authenticated
  using (app.has_branch_permission('members.read', branch_id));
create policy "member managers upload documents" on public.member_documents for insert to authenticated
  with check (
    app.has_branch_permission('members.manage', (select m.branch_id from public.members m where m.id = member_id))
  );
create policy "member managers remove draft documents" on public.member_documents for delete to authenticated
  using (app.has_branch_permission('members.manage', branch_id));
-- No update policy: an uploaded document is never changed, only replaced.

-- ---------------------------------------------------------------------------
-- Approval workflow
-- ---------------------------------------------------------------------------

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
  if v_member.status not in ('draft', 'returned') then
    raise exception 'only draft or returned files can be submitted' using errcode = 'check_violation';
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

create or replace function public.approve_member(p_member_id uuid)
returns public.members
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.members;
  v_branch_code text;
begin
  select * into v_member from public.members where id = p_member_id for update;
  if not found or not app.has_branch_permission('members.approve', v_member.branch_id) then
    raise exception 'member not found' using errcode = 'no_data_found';
  end if;
  if v_member.status <> 'pending_approval' then
    raise exception 'only files awaiting approval can be approved' using errcode = 'check_violation';
  end if;
  if auth.uid() in (v_member.created_by, v_member.submitted_by) then
    raise exception 'you prepared this file, so someone else must approve it' using errcode = 'insufficient_privilege';
  end if;

  select code into v_branch_code from public.branches where id = v_member.branch_id;

  perform app.begin_workflow();
  update public.members
     set status = 'approved',
         approved_by = auth.uid(),
         approved_at = now(),
         membership_no = 'KUN-' || v_branch_code || '-' || lpad(nextval('public.membership_number_seq')::text, 6, '0')
   where id = p_member_id
   returning * into v_member;
  perform app.end_workflow();
  return v_member;
end;
$$;

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
  if not found or not app.has_branch_permission('members.approve', v_member.branch_id) then
    raise exception 'member not found' using errcode = 'no_data_found';
  end if;
  if v_member.status <> 'pending_approval' then
    raise exception 'only files awaiting approval can be returned' using errcode = 'check_violation';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'say what needs correcting' using errcode = 'check_violation';
  end if;

  perform app.begin_workflow();
  update public.members
     set status = 'returned', return_reason = trim(p_reason)
   where id = p_member_id
   returning * into v_member;
  perform app.end_workflow();
  return v_member;
end;
$$;

revoke all on function public.submit_member(uuid) from public, anon;
revoke all on function public.approve_member(uuid) from public, anon;
revoke all on function public.return_member(uuid, text) from public, anon;
grant execute on function public.submit_member(uuid) to authenticated;
grant execute on function public.approve_member(uuid) to authenticated;
grant execute on function public.return_member(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Plans
-- ---------------------------------------------------------------------------

create table public.plan_types (
  code text primary key check (code ~ '^[a-z][a-z0-9_]*$'),
  name text not null,
  description text not null default '',
  is_active boolean not null default true,
  sort_order integer not null default 0
);

insert into public.plan_types (code, name, sort_order) values
  ('silver', 'Silver', 1),
  ('gold', 'Gold', 2),
  ('platinum', 'Platinum', 3);

create type public.plan_status as enum ('active', 'matured', 'liquidated', 'cancelled');

create table public.member_plans (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members (id) on delete restrict,
  branch_id uuid not null references public.branches (id),
  plan_type text not null references public.plan_types (code),
  contribution_amount numeric(14, 2) not null check (contribution_amount > 0),
  contribution_frequency text not null check (contribution_frequency in ('weekly', 'monthly', 'quarterly', 'one_off')),
  start_date date not null,
  maturity_date date not null,
  status public.plan_status not null default 'active',
  created_by uuid not null default auth.uid() references public.staff (id),
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  constraint member_plans_dates check (maturity_date > start_date)
);
create index member_plans_member_idx on public.member_plans (member_id);
create index member_plans_maturity_idx on public.member_plans (status, maturity_date);

create or replace function app.member_plans_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.members;
begin
  if tg_op = 'UPDATE' and not app.in_workflow() then
    raise exception 'plans change only through the plan workflow' using errcode = 'insufficient_privilege';
  end if;
  if tg_op = 'INSERT' then
    select * into v_member from public.members where id = new.member_id;
    if v_member.status <> 'approved' then
      raise exception 'plans can only be added to approved members' using errcode = 'check_violation';
    end if;
    if not exists (select 1 from public.plan_types where code = new.plan_type and is_active) then
      raise exception 'that plan is not available' using errcode = 'check_violation';
    end if;
    new.branch_id := v_member.branch_id;
    new.status := 'active';
    new.created_by := auth.uid();
    new.created_at := now();
    new.closed_at := null;
  end if;
  return new;
end;
$$;

create trigger member_plans_guard
  before insert or update on public.member_plans
  for each row execute function app.member_plans_guard();

select app.enable_audit('public.plan_types');
select app.enable_audit('public.member_plans');

alter table public.plan_types enable row level security;
alter table public.member_plans enable row level security;

create policy "staff can read plan types" on public.plan_types for select to authenticated using (true);

create policy "member readers see plans" on public.member_plans for select to authenticated
  using (app.has_branch_permission('members.read', branch_id));
create policy "member managers add plans" on public.member_plans for insert to authenticated
  with check (
    app.has_branch_permission('members.manage', (select m.branch_id from public.members m where m.id = member_id))
  );

-- ---------------------------------------------------------------------------
-- Contributions ledger
-- ---------------------------------------------------------------------------

create type public.contribution_kind as enum ('scheduled', 'top_up', 'reversal');

create table public.contributions (
  id uuid primary key default gen_random_uuid(),
  member_plan_id uuid not null references public.member_plans (id) on delete restrict,
  member_id uuid not null references public.members (id),
  branch_id uuid not null references public.branches (id),
  kind public.contribution_kind not null,
  amount numeric(14, 2) not null,
  paid_on date not null,
  payment_method text not null check (payment_method in ('bank_transfer', 'cash', 'pos', 'cheque')),
  reference text,
  notes text,
  reverses_id uuid unique references public.contributions (id),
  recorded_by uuid not null default auth.uid() references public.staff (id),
  recorded_at timestamptz not null default now(),
  verified_by uuid references public.staff (id),
  verified_at timestamptz,
  constraint contributions_reversal_link check ((kind = 'reversal') = (reverses_id is not null)),
  constraint contributions_sign check ((kind = 'reversal' and amount < 0) or (kind <> 'reversal' and amount > 0)),
  constraint contributions_reversal_reason check (kind <> 'reversal' or length(trim(coalesce(notes, ''))) > 0)
);
create index contributions_plan_idx on public.contributions (member_plan_id, paid_on);
create index contributions_branch_idx on public.contributions (branch_id, paid_on);

create or replace function app.contributions_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan public.member_plans;
  v_original public.contributions;
begin
  if tg_op = 'DELETE' then
    raise exception 'contributions are never deleted; record a reversal instead' using errcode = 'insufficient_privilege';
  end if;

  if tg_op = 'UPDATE' then
    if not app.in_workflow() then
      raise exception 'contributions are never edited; record a reversal instead' using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;

  if new.paid_on > current_date then
    raise exception 'payment date can''t be in the future' using errcode = 'check_violation';
  end if;

  select * into v_plan from public.member_plans where id = new.member_plan_id;
  if v_plan.status <> 'active' then
    raise exception 'contributions can only be recorded on active plans' using errcode = 'check_violation';
  end if;

  new.member_id := v_plan.member_id;
  new.branch_id := v_plan.branch_id;
  new.recorded_by := auth.uid();
  new.recorded_at := now();
  new.verified_by := null;
  new.verified_at := null;

  if new.kind = 'reversal' then
    select * into v_original from public.contributions where id = new.reverses_id;
    if v_original.member_plan_id is distinct from new.member_plan_id then
      raise exception 'a reversal must be on the same plan as the entry it reverses' using errcode = 'check_violation';
    end if;
    if v_original.kind = 'reversal' then
      raise exception 'a reversal can''t itself be reversed' using errcode = 'check_violation';
    end if;
    if new.amount <> -v_original.amount then
      raise exception 'a reversal must be for exactly the original amount' using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

create trigger contributions_guard
  before insert or update or delete on public.contributions
  for each row execute function app.contributions_guard();

select app.enable_audit('public.contributions');

alter table public.contributions enable row level security;

create policy "member readers see contributions" on public.contributions for select to authenticated
  using (app.has_branch_permission('members.read', branch_id));
create policy "recorders add contributions" on public.contributions for insert to authenticated
  with check (
    app.has_branch_permission(
      'contributions.record',
      (select p.branch_id from public.member_plans p where p.id = member_plan_id)
    )
  );

create or replace function public.verify_contribution(p_contribution_id uuid)
returns public.contributions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.contributions;
begin
  select * into v_row from public.contributions where id = p_contribution_id for update;
  if not found or not app.has_branch_permission('contributions.verify', v_row.branch_id) then
    raise exception 'contribution not found' using errcode = 'no_data_found';
  end if;
  if v_row.verified_at is not null then
    raise exception 'this payment is already verified' using errcode = 'check_violation';
  end if;
  if v_row.recorded_by = auth.uid() then
    raise exception 'you recorded this payment, so someone else must verify it' using errcode = 'insufficient_privilege';
  end if;

  perform app.begin_workflow();
  update public.contributions set verified_by = auth.uid(), verified_at = now()
   where id = p_contribution_id
   returning * into v_row;
  perform app.end_workflow();
  return v_row;
end;
$$;

revoke all on function public.verify_contribution(uuid) from public, anon;
grant execute on function public.verify_contribution(uuid) to authenticated;

-- Running totals per plan. security_invoker makes the caller's row level security apply.
create view public.member_plan_totals with (security_invoker = true) as
select
  p.id as member_plan_id,
  p.member_id,
  p.branch_id,
  coalesce(sum(c.amount), 0)::numeric(14, 2) as total_contributed,
  coalesce(sum(c.amount) filter (where c.verified_at is not null), 0)::numeric(14, 2) as total_verified,
  coalesce(sum(c.amount) filter (where c.kind = 'top_up'), 0)::numeric(14, 2) as total_top_ups,
  count(c.id) filter (where c.verified_at is null) as unverified_count,
  max(c.paid_on) as last_paid_on
from public.member_plans p
left join public.contributions c on c.member_plan_id = p.id
group by p.id;

grant select on public.member_plan_totals to authenticated;

-- ---------------------------------------------------------------------------
-- Staff display names: workflow screens show who prepared, approved or
-- verified a record. Returns names only (no email, roles or branch), and only
-- to active staff.
-- ---------------------------------------------------------------------------
create or replace function public.staff_display_names(p_ids uuid[])
returns table (id uuid, full_name text)
language sql stable security definer set search_path = ''
as $$
  select s.id, s.full_name
  from public.staff s
  where s.id = any(p_ids)
    and exists (select 1 from public.staff me where me.id = auth.uid() and me.is_active);
$$;
revoke all on function public.staff_display_names(uuid[]) from public, anon;
grant execute on function public.staff_display_names(uuid[]) to authenticated;
