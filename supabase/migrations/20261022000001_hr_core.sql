-- Human Resources, part 1: employee records, contracts, job changes, exits and ERP logins.
-- Also gives System Administrators a module of their own for staff access and the organisation structure.
--
-- How an employee moves through the system
--   (onboard) ──▶ probation ──confirm──▶ active ──exit──▶ resigned / terminated ──reinstate──▶ probation / active
--                     └──────────────────exit──────────────────┘
--
--   * An employee record is not an ERP login. Every employee has a record; only those who use the ERP have a login
--     (public.staff). HR creates the login from the record, and the record then keeps the login's name, department
--     and home branch in step with it.
--   * Branch, department, job title and status change only through the workflow functions below, so every
--     confirmation, transfer, promotion, exit and reinstatement leaves a dated line with a reason in the job history.
--   * Job titles come from a list HR maintains, because leave requests (next step) are routed by job title.
--   * An exit deactivates the employee's ERP login at once. Only the Head of HR confirms appointments, changes jobs,
--     records exits and reinstates, and nobody can do any of these to their own record.
--   * Pay (salary and allowances) is not part of this step. It arrives with payroll, with its own approval.

-- ---------------------------------------------------------------------------
-- Department, permissions and roles
-- ---------------------------------------------------------------------------

insert into public.departments (code, name) values ('hr', 'Human Resources');

insert into public.permissions (code, description) values
  ('module.hr', 'Open the Human Resources module'),
  ('hr.read', 'View employee records, documents, contracts and job history'),
  ('hr.manage', 'Create and update employee records, upload documents, add contracts and create ERP logins'),
  ('hr.approve', 'Confirm appointments, transfer or promote staff, record exits and reinstate staff'),
  ('hr.config', 'Maintain the list of job titles'),
  ('module.system', 'Open the System Administration module');

insert into public.roles (code, department_code, name, description) values
  ('hr_officer', 'hr', 'HR Officer', 'Keeps employee records, documents and contracts up to date and onboards new staff'),
  ('head_of_hr', 'hr', 'Head of HR', 'Confirms appointments, approves transfers and promotions, records exits and owns the job titles');

insert into public.role_permissions (role_code, permission_code) values
  ('hr_officer', 'module.hr'),
  ('hr_officer', 'hr.read'),
  ('hr_officer', 'hr.manage'),
  ('head_of_hr', 'module.hr'),
  ('head_of_hr', 'hr.read'),
  ('head_of_hr', 'hr.manage'),
  ('head_of_hr', 'hr.approve'),
  ('head_of_hr', 'hr.config'),
  ('head_of_hr', 'staff.read'),
  -- Auditors read employee records but can't change them.
  ('internal_auditor', 'module.hr'),
  ('internal_auditor', 'hr.read'),
  ('system_admin', 'module.system');

-- ---------------------------------------------------------------------------
-- Staff accounts: forced password change, and protection for fields HR owns
-- ---------------------------------------------------------------------------

-- Set when an account is created or its password is reset by someone else; the app asks for a new password first.
alter table public.staff add column must_change_password boolean not null default false;

-- Clears the flag once the signed-in staff member has chosen their own password.
create or replace function public.password_changed()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.staff set must_change_password = false where id = auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- Job titles
-- ---------------------------------------------------------------------------

create table public.job_titles (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index job_titles_name_idx on public.job_titles (lower(trim(name)));

-- The titles the HRMS leave approval chain used, so the chain can be set up straight away.
insert into public.job_titles (name) values
  ('Supervisor'),
  ('Chief Technology Officer'),
  ('Chief Operating Officer'),
  ('Branch Manager'),
  ('Marketing Manager'),
  ('Regional Manager'),
  ('Assistant Regional Manager'),
  ('Business Development Manager'),
  ('HR Officer'),
  ('Head of HR'),
  ('Account Officer'),
  ('Accountant'),
  ('Administrative Officer');

select app.enable_audit('public.job_titles');

alter table public.job_titles enable row level security;

create policy "staff can read job titles" on public.job_titles for select to authenticated using (true);
create policy "hr config adds job titles" on public.job_titles for insert to authenticated
  with check (app.has_permission('hr.config'));
create policy "hr config edits job titles" on public.job_titles for update to authenticated
  using (app.has_permission('hr.config')) with check (app.has_permission('hr.config'));
-- No delete policy: a title stays on the employees who held it. Deactivate it instead.

-- ---------------------------------------------------------------------------
-- Employees
-- ---------------------------------------------------------------------------

create type public.employee_status as enum ('probation', 'active', 'resigned', 'terminated');

create sequence public.employee_number_seq;

create table public.employees (
  id uuid primary key default gen_random_uuid(),
  employee_no text not null unique,
  staff_id uuid unique references public.staff (id) on delete restrict,
  status public.employee_status not null default 'probation',

  -- Job
  branch_id uuid not null references public.branches (id) on delete restrict,
  department_code text not null references public.departments (code) on delete restrict,
  job_title_id uuid not null references public.job_titles (id) on delete restrict,
  employment_type text not null check (employment_type in ('permanent', 'contract', 'intern', 'consultant')),
  hire_date date not null,
  probation_end_date date,
  confirmed_on date,
  exit_date date,
  exit_reason text,

  -- Personal
  title text,
  first_name text not null check (length(trim(first_name)) > 0),
  middle_name text,
  last_name text not null check (length(trim(last_name)) > 0),
  date_of_birth date,
  gender text check (gender in ('female', 'male')),
  marital_status text check (marital_status in ('single', 'married', 'divorced', 'widowed')),
  phone text not null check (length(trim(phone)) >= 7),
  personal_email text check (personal_email is null or personal_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  work_email text check (work_email is null or work_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  address text not null check (length(trim(address)) > 0),
  state_of_origin text,
  nationality text,

  -- Identification
  nin text unique check (nin is null or nin ~ '^[0-9]{11}$'),
  id_type text check (id_type in ('national_id', 'drivers_licence', 'international_passport', 'voters_card')),
  id_number text,

  -- Emergency contact
  emergency_contact_name text,
  emergency_contact_phone text,
  emergency_contact_relationship text,

  -- Where pay goes (amounts arrive with payroll)
  bank_name text,
  bank_account_number text check (bank_account_number is null or bank_account_number ~ '^[0-9]{10}$'),
  pension_administrator text,
  pension_pin text,
  tax_id text,

  created_by uuid not null default auth.uid() references public.staff (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint employees_probation_after_hire check (probation_end_date is null or probation_end_date >= hire_date),
  constraint employees_exit_after_hire check (exit_date is null or exit_date >= hire_date),
  constraint employees_born_before_hire check (date_of_birth is null or date_of_birth < hire_date),
  constraint employees_exit_fields check ((status in ('resigned', 'terminated')) = (exit_date is not null))
);
create unique index employees_work_email_idx on public.employees (lower(work_email));
create index employees_branch_status_idx on public.employees (branch_id, status);
create index employees_name_idx on public.employees (lower(last_name), lower(first_name));

-- One line per change to where someone works, what they do, or whether they still work here.
create table public.employee_job_history (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees (id) on delete restrict,
  event text not null check (event in (
    'joined', 'confirmed', 'transfer', 'promotion', 'redeployment', 'resigned', 'terminated', 'reinstated'
  )),
  effective_date date not null,
  branch_id uuid not null references public.branches (id),
  department_code text not null references public.departments (code),
  job_title_id uuid not null references public.job_titles (id),
  status public.employee_status not null,
  reason text,
  recorded_by uuid default auth.uid() references public.staff (id),
  recorded_at timestamptz not null default now()
);
create index employee_job_history_employee_idx on public.employee_job_history (employee_id, effective_date);

-- The branch an employee works at now. Child records (documents, contracts, dependents) follow it, so a transfer
-- moves the whole file to the new branch's HR staff.
create or replace function app.employee_branch(p_employee_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select branch_id from public.employees where id = p_employee_id;
$$;
revoke all on function app.employee_branch(uuid) from public, anon;
grant execute on function app.employee_branch(uuid) to authenticated;

-- True when the signed-in staff member's own login is linked to this employee record.
create or replace function app.is_own_employee_record(p_employee_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.employees where id = p_employee_id and staff_id = auth.uid());
$$;
revoke all on function app.is_own_employee_record(uuid) from public, anon;
grant execute on function app.is_own_employee_record(uuid) to authenticated;

-- The next free employee number. Records brought over from the old HR system keep their own numbers, so skip any
-- number already taken. Security definer so it sees every branch's numbers, not just the caller's.
create or replace function app.next_employee_no()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_no text;
begin
  loop
    v_no := 'SK-' || lpad(nextval('public.employee_number_seq')::text, 5, '0');
    exit when not exists (select 1 from public.employees where employee_no = v_no);
  end loop;
  return v_no;
end;
$$;
revoke all on function app.next_employee_no() from public, anon;
grant execute on function app.next_employee_no() to authenticated;

create or replace function app.employees_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.date_of_birth is not null and new.date_of_birth >= current_date then
    raise exception 'date of birth must be in the past' using errcode = 'check_violation';
  end if;
  new.work_email := nullif(lower(trim(new.work_email)), '');

  if tg_op = 'INSERT' then
    if not app.in_workflow() then
      -- New starters begin on probation. The Head of HR may enter existing, already-confirmed staff as active.
      if new.status = 'active' and app.has_branch_permission('hr.approve', new.branch_id) then
        new.confirmed_on := coalesce(new.confirmed_on, new.hire_date);
      else
        new.status := 'probation';
        new.confirmed_on := null;
      end if;
      new.staff_id := null;
      new.exit_date := null;
      new.exit_reason := null;
      new.created_by := auth.uid();
      new.created_at := now();
    end if;
    new.employee_no := nullif(upper(trim(new.employee_no)), '');
    if new.employee_no is null then
      new.employee_no := app.next_employee_no();
    end if;
    if not exists (select 1 from public.job_titles where id = new.job_title_id and is_active) then
      raise exception 'that job title is no longer in use' using errcode = 'check_violation';
    end if;
    return new;
  end if;

  new.updated_at := now();
  if app.in_workflow() then
    return new;
  end if;

  if new.status is distinct from old.status
     or new.branch_id is distinct from old.branch_id
     or new.department_code is distinct from old.department_code
     or new.job_title_id is distinct from old.job_title_id
     or new.staff_id is distinct from old.staff_id
     or new.confirmed_on is distinct from old.confirmed_on
     or new.exit_date is distinct from old.exit_date
     or new.exit_reason is distinct from old.exit_reason
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'job, status and login details change only through confirmations, job changes and exits'
      using errcode = 'insufficient_privilege';
  end if;
  if new.employee_no is distinct from old.employee_no then
    raise exception 'the employee number can''t be changed' using errcode = 'insufficient_privilege';
  end if;
  if old.staff_id is not null and new.work_email is distinct from old.work_email then
    raise exception 'this employee signs in with their work email, so it can''t be changed here'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger employees_guard
  before insert or update on public.employees
  for each row execute function app.employees_guard();

-- Writes the job history and keeps a linked ERP login's name, department and branch in step with the record.
create or replace function app.employees_after_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_in_workflow boolean := app.in_workflow();
begin
  if tg_op = 'INSERT' then
    insert into public.employee_job_history (employee_id, event, effective_date, branch_id, department_code, job_title_id, status)
    values (new.id, 'joined', new.hire_date, new.branch_id, new.department_code, new.job_title_id, new.status);
    return new;
  end if;

  if new.staff_id is not null
     and (new.staff_id is distinct from old.staff_id
          or new.first_name is distinct from old.first_name
          or new.last_name is distinct from old.last_name
          or new.department_code is distinct from old.department_code
          or new.branch_id is distinct from old.branch_id) then
    perform app.begin_workflow();
    update public.staff
       set full_name = new.first_name || ' ' || new.last_name,
           department_code = new.department_code,
           home_branch_id = new.branch_id
     where id = new.staff_id;
    -- Leave the flag as the caller had it: a workflow function may still have changes to make.
    if not v_in_workflow then
      perform app.end_workflow();
    end if;
  end if;
  return new;
end;
$$;

create trigger employees_after_change
  after insert or update on public.employees
  for each row execute function app.employees_after_change();

select app.enable_audit('public.employees');
select app.enable_audit('public.employee_job_history');

alter table public.employees enable row level security;
alter table public.employee_job_history enable row level security;

create policy "hr readers see their branches' employees" on public.employees for select to authenticated
  using (app.has_branch_permission('hr.read', branch_id));
create policy "staff see their own employee record" on public.employees for select to authenticated
  using (staff_id = auth.uid());
create policy "hr managers add employees" on public.employees for insert to authenticated
  with check (app.has_branch_permission('hr.manage', branch_id));
create policy "hr managers edit employees" on public.employees for update to authenticated
  using (app.has_branch_permission('hr.manage', branch_id))
  with check (app.has_branch_permission('hr.manage', branch_id));
-- No delete policy: employee records are kept after people leave.

create policy "hr readers see job history" on public.employee_job_history for select to authenticated
  using (app.has_branch_permission('hr.read', app.employee_branch(employee_id)) or app.is_own_employee_record(employee_id));
-- Written only by the trigger and workflow functions.

-- Staff accounts linked to an employee take their name, department and branch from HR, and nobody switches off
-- their own account. A login's email is its sign-in name, so it changes only with the login itself.
create or replace function app.staff_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if app.in_workflow() then
    return new;
  end if;
  if new.id = auth.uid() and new.is_active is distinct from old.is_active then
    raise exception 'you can''t deactivate your own account' using errcode = 'insufficient_privilege';
  end if;
  if new.email is distinct from old.email then
    raise exception 'a login''s email is its sign-in name and can''t be changed' using errcode = 'check_violation';
  end if;
  if new.is_active and not old.is_active
     and exists (select 1 from public.employees e where e.staff_id = new.id and e.status in ('resigned', 'terminated')) then
    raise exception 'HR has recorded that this person left; HR has to reinstate them first' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.employees e where e.staff_id = new.id)
     and (new.full_name is distinct from old.full_name
          or new.department_code is distinct from old.department_code
          or new.home_branch_id is distinct from old.home_branch_id) then
    raise exception 'this person''s name, department and branch come from their HR record'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger staff_guard
  before update on public.staff
  for each row execute function app.staff_guard();

-- ---------------------------------------------------------------------------
-- Dependents and qualifications
-- ---------------------------------------------------------------------------

create table public.employee_dependents (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees (id) on delete restrict,
  full_name text not null check (length(trim(full_name)) > 0),
  relationship text not null check (relationship in ('spouse', 'child', 'parent', 'sibling', 'other')),
  date_of_birth date check (date_of_birth is null or date_of_birth <= current_date),
  created_at timestamptz not null default now()
);
create index employee_dependents_employee_idx on public.employee_dependents (employee_id);

create table public.employee_qualifications (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees (id) on delete restrict,
  kind text not null check (kind in ('education', 'professional')),
  qualification text not null check (length(trim(qualification)) > 0),
  course text,
  institution text,
  year_obtained integer check (year_obtained between 1950 and 2100),
  created_at timestamptz not null default now()
);
create index employee_qualifications_employee_idx on public.employee_qualifications (employee_id);

select app.enable_audit('public.employee_dependents');
select app.enable_audit('public.employee_qualifications');

alter table public.employee_dependents enable row level security;
alter table public.employee_qualifications enable row level security;

create policy "hr readers see dependents" on public.employee_dependents for select to authenticated
  using (app.has_branch_permission('hr.read', app.employee_branch(employee_id)) or app.is_own_employee_record(employee_id));
create policy "hr managers add dependents" on public.employee_dependents for insert to authenticated
  with check (app.has_branch_permission('hr.manage', app.employee_branch(employee_id)));
create policy "hr managers remove dependents" on public.employee_dependents for delete to authenticated
  using (app.has_branch_permission('hr.manage', app.employee_branch(employee_id)));

create policy "hr readers see qualifications" on public.employee_qualifications for select to authenticated
  using (app.has_branch_permission('hr.read', app.employee_branch(employee_id)) or app.is_own_employee_record(employee_id));
create policy "hr managers add qualifications" on public.employee_qualifications for insert to authenticated
  with check (app.has_branch_permission('hr.manage', app.employee_branch(employee_id)));
create policy "hr managers remove qualifications" on public.employee_qualifications for delete to authenticated
  using (app.has_branch_permission('hr.manage', app.employee_branch(employee_id)));

-- ---------------------------------------------------------------------------
-- Documents (files live in the private "hr-documents" bucket at <employee_id>/<file>)
-- ---------------------------------------------------------------------------

create type public.employee_document_type as enum (
  'passport_photo', 'cv', 'offer_letter', 'acceptance_letter', 'employment_contract', 'id_document', 'certificate',
  'guarantor_form', 'reference_letter', 'medical_report', 'query_letter', 'exit_letter', 'other'
);

create table public.employee_documents (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees (id) on delete restrict,
  document_type public.employee_document_type not null,
  file_name text not null,
  storage_path text not null unique,
  mime_type text not null check (mime_type in ('application/pdf', 'image/jpeg', 'image/png')),
  size_bytes integer not null check (size_bytes > 0 and size_bytes <= 10485760),
  uploaded_by uuid not null default auth.uid() references public.staff (id),
  uploaded_at timestamptz not null default now()
);
create index employee_documents_employee_idx on public.employee_documents (employee_id);

create or replace function app.employee_documents_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.uploaded_by := auth.uid();
  new.uploaded_at := now();
  if new.storage_path not like new.employee_id::text || '/%' then
    raise exception 'storage path must sit under the employee''s folder' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger employee_documents_guard
  before insert on public.employee_documents
  for each row execute function app.employee_documents_guard();

select app.enable_audit('public.employee_documents');

alter table public.employee_documents enable row level security;

create policy "hr readers see employee documents" on public.employee_documents for select to authenticated
  using (app.has_branch_permission('hr.read', app.employee_branch(employee_id)) or app.is_own_employee_record(employee_id));
create policy "hr managers upload employee documents" on public.employee_documents for insert to authenticated
  with check (app.has_branch_permission('hr.manage', app.employee_branch(employee_id)));
create policy "hr managers remove employee documents" on public.employee_documents for delete to authenticated
  using (app.has_branch_permission('hr.manage', app.employee_branch(employee_id)));
-- No update policy. Removing a document removes it from the file; the stored file is kept as evidence.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('hr-documents', 'hr-documents', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;

create or replace function app.storage_path_employee(p_name text)
returns uuid
language sql
immutable
as $$
  select case
    when (storage.foldername(p_name))[1] ~ '^[0-9a-f-]{36}$' then (storage.foldername(p_name))[1]::uuid
  end;
$$;

create policy "hr readers download employee documents" on storage.objects for select to authenticated
  using (
    bucket_id = 'hr-documents'
    and (
      app.has_branch_permission('hr.read', app.employee_branch(app.storage_path_employee(name)))
      or app.is_own_employee_record(app.storage_path_employee(name))
    )
  );
create policy "hr managers upload employee documents" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'hr-documents'
    and app.has_branch_permission('hr.manage', app.employee_branch(app.storage_path_employee(name)))
  );

-- ---------------------------------------------------------------------------
-- Contracts
-- ---------------------------------------------------------------------------

create table public.employee_contracts (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees (id) on delete restrict,
  contract_type text not null check (contract_type in ('permanent', 'fixed_term', 'probation', 'internship', 'consultancy')),
  start_date date not null,
  end_date date,
  terminated_on date,
  notes text,
  created_by uuid not null default auth.uid() references public.staff (id),
  created_at timestamptz not null default now(),
  constraint employee_contracts_end_after_start check (end_date is null or end_date >= start_date),
  constraint employee_contracts_terminated_after_start check (terminated_on is null or terminated_on >= start_date),
  constraint employee_contracts_end_needed check (contract_type = 'permanent' or end_date is not null)
);
create index employee_contracts_employee_idx on public.employee_contracts (employee_id, start_date);
create index employee_contracts_end_idx on public.employee_contracts (end_date) where terminated_on is null;

-- A new contract replaces the one before it: the earlier one ends the day before the new one starts.
-- After that only the end date (to extend or shorten it) and the notes can change.
create or replace function app.employee_contracts_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee public.employees;
  v_in_workflow boolean;
begin
  if tg_op = 'DELETE' then
    raise exception 'contracts are kept on the file; add a new one to replace it' using errcode = 'insufficient_privilege';
  end if;

  if tg_op = 'UPDATE' then
    if app.in_workflow() then
      return new;
    end if;
    if new.employee_id is distinct from old.employee_id
       or new.contract_type is distinct from old.contract_type
       or new.start_date is distinct from old.start_date
       or new.terminated_on is distinct from old.terminated_on
       or new.created_by is distinct from old.created_by
       or new.created_at is distinct from old.created_at then
      raise exception 'only a contract''s end date and notes can change; add a new contract instead'
        using errcode = 'insufficient_privilege';
    end if;
    if old.terminated_on is not null then
      raise exception 'this contract has ended and can''t be changed' using errcode = 'check_violation';
    end if;
    return new;
  end if;

  select * into v_employee from public.employees where id = new.employee_id;
  if v_employee.status not in ('probation', 'active') then
    raise exception 'contracts can only be added for current employees' using errcode = 'check_violation';
  end if;
  if exists (
    select 1 from public.employee_contracts c
    where c.employee_id = new.employee_id and c.terminated_on is null and c.start_date >= new.start_date
  ) then
    raise exception 'a new contract must start after the current one started' using errcode = 'check_violation';
  end if;

  new.created_by := auth.uid();
  new.created_at := now();
  new.terminated_on := null;

  v_in_workflow := app.in_workflow();
  perform app.begin_workflow();
  update public.employee_contracts
     set terminated_on = new.start_date - 1
   where employee_id = new.employee_id
     and terminated_on is null
     and (end_date is null or end_date >= new.start_date);
  if not v_in_workflow then
    perform app.end_workflow();
  end if;
  return new;
end;
$$;

create trigger employee_contracts_guard
  before insert or update or delete on public.employee_contracts
  for each row execute function app.employee_contracts_guard();

select app.enable_audit('public.employee_contracts');

alter table public.employee_contracts enable row level security;

create policy "hr readers see contracts" on public.employee_contracts for select to authenticated
  using (app.has_branch_permission('hr.read', app.employee_branch(employee_id)) or app.is_own_employee_record(employee_id));
create policy "hr managers add contracts" on public.employee_contracts for insert to authenticated
  with check (app.has_branch_permission('hr.manage', app.employee_branch(employee_id)));
create policy "hr managers change contract end dates" on public.employee_contracts for update to authenticated
  using (app.has_branch_permission('hr.manage', app.employee_branch(employee_id)))
  with check (app.has_branch_permission('hr.manage', app.employee_branch(employee_id)));

-- ---------------------------------------------------------------------------
-- Workflow: confirm, change job, exit, reinstate
-- ---------------------------------------------------------------------------

-- Locks the employee and checks the caller may act on them with the permission, and isn't acting on themselves.
create or replace function app.employee_for_action(p_employee_id uuid, p_permission text)
returns public.employees
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee public.employees;
begin
  select * into v_employee from public.employees where id = p_employee_id for update;
  if not found or not app.has_branch_permission(p_permission, v_employee.branch_id) then
    raise exception 'employee not found' using errcode = 'no_data_found';
  end if;
  if v_employee.staff_id = auth.uid() then
    raise exception 'someone else has to make this change to your own record' using errcode = 'insufficient_privilege';
  end if;
  return v_employee;
end;
$$;
revoke all on function app.employee_for_action(uuid, text) from public, anon, authenticated;

create or replace function public.confirm_employee(p_employee_id uuid, p_confirmed_on date)
returns public.employees
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee public.employees := app.employee_for_action(p_employee_id, 'hr.approve');
begin
  if v_employee.status <> 'probation' then
    raise exception 'only staff on probation can be confirmed' using errcode = 'check_violation';
  end if;
  if p_confirmed_on is null or p_confirmed_on < v_employee.hire_date or p_confirmed_on > current_date then
    raise exception 'the confirmation date must be between the hire date and today' using errcode = 'check_violation';
  end if;

  perform app.begin_workflow();
  update public.employees set status = 'active', confirmed_on = p_confirmed_on
   where id = p_employee_id
   returning * into v_employee;
  insert into public.employee_job_history (employee_id, event, effective_date, branch_id, department_code, job_title_id, status)
  values (v_employee.id, 'confirmed', p_confirmed_on, v_employee.branch_id, v_employee.department_code, v_employee.job_title_id, 'active');
  perform app.end_workflow();
  return v_employee;
end;
$$;

-- Transfers, promotions and redeployments. Takes effect immediately; the effective date is what goes on the file.
create or replace function public.change_employee_job(
  p_employee_id uuid,
  p_event text,
  p_branch_id uuid,
  p_department_code text,
  p_job_title_id uuid,
  p_effective_date date,
  p_reason text
)
returns public.employees
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee public.employees := app.employee_for_action(p_employee_id, 'hr.approve');
begin
  if p_event not in ('transfer', 'promotion', 'redeployment') then
    raise exception 'say whether this is a transfer, promotion or redeployment' using errcode = 'check_violation';
  end if;
  if v_employee.status not in ('probation', 'active') then
    raise exception 'only current employees can change jobs' using errcode = 'check_violation';
  end if;
  if not app.has_branch_permission('hr.approve', p_branch_id) then
    raise exception 'you can''t move staff to that branch' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from public.job_titles where id = p_job_title_id and is_active) then
    raise exception 'that job title is no longer in use' using errcode = 'check_violation';
  end if;
  if p_branch_id is not distinct from v_employee.branch_id
     and p_department_code is not distinct from v_employee.department_code
     and p_job_title_id is not distinct from v_employee.job_title_id then
    raise exception 'nothing changes: choose a different branch, department or job title' using errcode = 'check_violation';
  end if;
  if p_effective_date is null or p_effective_date < v_employee.hire_date then
    raise exception 'the effective date can''t be before the hire date' using errcode = 'check_violation';
  end if;
  if p_reason is null or length(trim(p_reason)) < 5 then
    raise exception 'give the reason for the change' using errcode = 'check_violation';
  end if;

  perform app.begin_workflow();
  update public.employees
     set branch_id = p_branch_id, department_code = p_department_code, job_title_id = p_job_title_id
   where id = p_employee_id
   returning * into v_employee;
  insert into public.employee_job_history
    (employee_id, event, effective_date, branch_id, department_code, job_title_id, status, reason)
  values
    (v_employee.id, p_event, p_effective_date, v_employee.branch_id, v_employee.department_code, v_employee.job_title_id,
     v_employee.status, trim(p_reason));
  perform app.end_workflow();
  return v_employee;
end;
$$;

-- Resignation or termination. Ends the current contract and switches off the employee's ERP login.
create or replace function public.record_employee_exit(p_employee_id uuid, p_kind text, p_exit_date date, p_reason text)
returns public.employees
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee public.employees := app.employee_for_action(p_employee_id, 'hr.approve');
begin
  if p_kind not in ('resigned', 'terminated') then
    raise exception 'say whether the employee resigned or was terminated' using errcode = 'check_violation';
  end if;
  if v_employee.status not in ('probation', 'active') then
    raise exception 'this employee has already left' using errcode = 'check_violation';
  end if;
  if p_exit_date is null or p_exit_date < v_employee.hire_date or p_exit_date > current_date then
    raise exception 'the exit date must be between the hire date and today' using errcode = 'check_violation';
  end if;
  if p_reason is null or length(trim(p_reason)) < 5 then
    raise exception 'give the reason for leaving' using errcode = 'check_violation';
  end if;

  perform app.begin_workflow();
  update public.employees
     set status = p_kind::public.employee_status, exit_date = p_exit_date, exit_reason = trim(p_reason)
   where id = p_employee_id
   returning * into v_employee;
  insert into public.employee_job_history
    (employee_id, event, effective_date, branch_id, department_code, job_title_id, status, reason)
  values
    (v_employee.id, p_kind, p_exit_date, v_employee.branch_id, v_employee.department_code, v_employee.job_title_id,
     v_employee.status, trim(p_reason));
  update public.employee_contracts
     set terminated_on = greatest(p_exit_date, start_date)
   where employee_id = p_employee_id
     and terminated_on is null
     and (end_date is null or end_date > p_exit_date);
  if v_employee.staff_id is not null then
    update public.staff set is_active = false where id = v_employee.staff_id;
  end if;
  perform app.end_workflow();
  return v_employee;
end;
$$;

-- Undoes an exit recorded in error, or takes someone back. Their login comes back on; a new contract is added
-- separately.
create or replace function public.reinstate_employee(p_employee_id uuid, p_reason text)
returns public.employees
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee public.employees := app.employee_for_action(p_employee_id, 'hr.approve');
begin
  if v_employee.status not in ('resigned', 'terminated') then
    raise exception 'only staff who have left can be reinstated' using errcode = 'check_violation';
  end if;
  if p_reason is null or length(trim(p_reason)) < 5 then
    raise exception 'give the reason for reinstating' using errcode = 'check_violation';
  end if;

  perform app.begin_workflow();
  update public.employees
     set status = case when confirmed_on is null then 'probation' else 'active' end::public.employee_status,
         exit_date = null,
         exit_reason = null
   where id = p_employee_id
   returning * into v_employee;
  insert into public.employee_job_history
    (employee_id, event, effective_date, branch_id, department_code, job_title_id, status, reason)
  values
    (v_employee.id, 'reinstated', current_date, v_employee.branch_id, v_employee.department_code, v_employee.job_title_id,
     v_employee.status, trim(p_reason));
  if v_employee.staff_id is not null then
    update public.staff set is_active = true where id = v_employee.staff_id;
  end if;
  perform app.end_workflow();
  return v_employee;
end;
$$;

-- ---------------------------------------------------------------------------
-- ERP logins for employees
-- ---------------------------------------------------------------------------

-- Links an employee to the ERP login with their work email. The app creates the login (Supabase Auth) first;
-- this then creates the matching staff account, or links the one that already exists. Roles are granted
-- separately by a System Administrator. Returns true when a new staff account was created.
create or replace function public.link_employee_login(p_employee_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee public.employees;
  v_user_id uuid;
  v_created boolean := false;
begin
  select * into v_employee from public.employees where id = p_employee_id for update;
  if not found or not app.has_branch_permission('hr.manage', v_employee.branch_id) then
    raise exception 'employee not found' using errcode = 'no_data_found';
  end if;
  if v_employee.staff_id is not null then
    raise exception 'this employee already has an ERP login' using errcode = 'check_violation';
  end if;
  if v_employee.status not in ('probation', 'active') then
    raise exception 'only current employees can have an ERP login' using errcode = 'check_violation';
  end if;
  if v_employee.work_email is null then
    raise exception 'add a work email first; it is what the employee signs in with' using errcode = 'check_violation';
  end if;

  select id into v_user_id from auth.users where lower(email) = v_employee.work_email;
  if v_user_id is null then
    raise exception 'there is no login for % yet', v_employee.work_email using errcode = 'no_data_found';
  end if;
  if exists (select 1 from public.employees where staff_id = v_user_id) then
    raise exception 'that login already belongs to another employee' using errcode = 'check_violation';
  end if;

  perform app.begin_workflow();
  if not exists (select 1 from public.staff where id = v_user_id) then
    insert into public.staff (id, full_name, email, department_code, home_branch_id, must_change_password)
    values (v_user_id, v_employee.first_name || ' ' || v_employee.last_name, v_employee.work_email,
            v_employee.department_code, v_employee.branch_id, true);
    v_created := true;
  end if;
  update public.employees set staff_id = v_user_id where id = p_employee_id;
  perform app.end_workflow();
  return v_created;
end;
$$;

-- Whether an employee's login is switched on, still on its temporary password, and which roles it holds.
-- HR can't read staff accounts directly; this tells them just enough to follow up.
create or replace function public.employee_login_status(p_employee_id uuid)
returns table (is_active boolean, must_change_password boolean, roles text[])
language sql
stable
security definer
set search_path = ''
as $$
  select s.is_active, s.must_change_password,
         coalesce(array(
           select r.name from public.staff_roles sr join public.roles r on r.code = sr.role_code
           where sr.staff_id = s.id order by r.name
         ), '{}')
  from public.employees e
  join public.staff s on s.id = e.staff_id
  where e.id = p_employee_id
    and (app.has_branch_permission('hr.read', e.branch_id) or e.staff_id = auth.uid());
$$;

-- ---------------------------------------------------------------------------
-- Function grants
-- ---------------------------------------------------------------------------

revoke all on function public.employee_login_status(uuid) from public, anon;
grant execute on function public.employee_login_status(uuid) to authenticated;
revoke all on function public.password_changed() from public, anon;
revoke all on function public.confirm_employee(uuid, date) from public, anon;
revoke all on function public.change_employee_job(uuid, text, uuid, text, uuid, date, text) from public, anon;
revoke all on function public.record_employee_exit(uuid, text, date, text) from public, anon;
revoke all on function public.reinstate_employee(uuid, text) from public, anon;
revoke all on function public.link_employee_login(uuid) from public, anon;

grant execute on function public.password_changed() to authenticated;
grant execute on function public.confirm_employee(uuid, date) to authenticated;
grant execute on function public.change_employee_job(uuid, text, uuid, text, uuid, date, text) to authenticated;
grant execute on function public.record_employee_exit(uuid, text, date, text) to authenticated;
grant execute on function public.reinstate_employee(uuid, text) to authenticated;
grant execute on function public.link_employee_login(uuid) to authenticated;
