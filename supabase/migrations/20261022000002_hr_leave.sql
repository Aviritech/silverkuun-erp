-- Human Resources, part 2: leave.
--
-- How a leave request moves through the system
--   request ──▶ relief officer agrees ──▶ step 1 ──▶ step 2 ──▶ … ──▶ approved
--                        └────────── any step rejects ──────────────▶ rejected
--   The employee can cancel while it is pending, or once approved if it hasn't started.
--
--   * Requests are routed by job title, the way the old HR system did it: each step names the job titles that may
--     approve it, and whether the approver must work at the same branch, in the same region or anywhere (and
--     optionally in the same department). A step nobody can approve is skipped when the request is made; if every
--     step is skipped, the Head of HR approves it.
--   * The relief officer, the colleague who covers the work, is chosen on the request and agrees first.
--   * Days are working days: weekends and public holidays don't count.
--   * The balance is the year's entitlement (pro-rated in the year someone joins, plus long-service days) less
--     approved and pending requests, so two requests can't spend the same days.
--   * Nobody approves their own request. The Head of HR can approve or reject any request outright, with a reason.

-- ---------------------------------------------------------------------------
-- Leave types and public holidays
-- ---------------------------------------------------------------------------

create table public.leave_types (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  days_per_year integer not null check (days_per_year >= 0),
  is_paid boolean not null default true,
  -- Unpaid leave and the like don't come out of a balance.
  uses_balance boolean not null default true,
  -- New starters get a share of the year's days for the months left.
  prorate boolean not null default true,
  max_days_per_request integer check (max_days_per_request > 0),
  -- Longer requests need a supporting document, such as a medical certificate.
  document_after_days integer check (document_after_days >= 0),
  extra_days_after_5_years integer not null default 0 check (extra_days_after_5_years >= 0),
  extra_days_after_10_years integer not null default 0 check (extra_days_after_10_years >= 0),
  only_for_gender text check (only_for_gender in ('female', 'male')),
  is_active boolean not null default true,
  sort_order integer not null default 0
);
create unique index leave_types_name_idx on public.leave_types (lower(trim(name)));

-- The old HR system's leave types and days, plus unpaid, maternity and paternity leave.
insert into public.leave_types
  (name, days_per_year, is_paid, uses_balance, prorate, max_days_per_request, document_after_days,
   extra_days_after_5_years, extra_days_after_10_years, only_for_gender, sort_order) values
  ('Annual leave', 10, true, true, true, 30, null, 3, 5, null, 10),
  ('Casual leave', 5, true, true, true, null, null, 0, 0, null, 20),
  ('Sick leave', 5, true, true, false, null, 3, 0, 0, null, 30),
  ('Compassionate leave', 5, true, true, false, null, null, 0, 0, null, 40),
  ('Exam leave', 5, true, true, false, null, 1, 0, 0, null, 50),
  ('Special leave (wedding)', 10, true, true, false, null, null, 0, 0, null, 60),
  ('Maternity leave', 60, true, true, false, null, 0, 0, 0, 'female', 70),
  ('Paternity leave', 10, true, true, false, null, null, 0, 0, 'male', 80),
  ('Unpaid leave', 0, false, false, false, null, null, 0, 0, null, 90);

create table public.public_holidays (
  holiday_date date primary key,
  name text not null check (length(trim(name)) > 0)
);

-- Fixed-date holidays and Easter for 2026. Add Eid and other declared holidays as the government announces them.
insert into public.public_holidays (holiday_date, name) values
  ('2026-01-01', 'New Year''s Day'),
  ('2026-04-03', 'Good Friday'),
  ('2026-04-06', 'Easter Monday'),
  ('2026-05-01', 'Workers'' Day'),
  ('2026-06-12', 'Democracy Day'),
  ('2026-10-01', 'Independence Day'),
  ('2026-12-25', 'Christmas Day'),
  ('2026-12-26', 'Boxing Day');

-- Working days from p_start to p_end inclusive: Monday to Friday, less public holidays.
create or replace function app.working_days(p_start date, p_end date)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from generate_series(p_start, p_end, interval '1 day') d
  where extract(isodow from d) < 6
    and not exists (select 1 from public.public_holidays h where h.holiday_date = d::date);
$$;
revoke all on function app.working_days(date, date) from public, anon;
grant execute on function app.working_days(date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- The approval chain
-- ---------------------------------------------------------------------------

create table public.leave_approval_steps (
  id uuid primary key default gen_random_uuid(),
  step_order integer not null check (step_order > 0),
  name text not null check (length(trim(name)) > 0),
  job_title_ids uuid[] not null check (cardinality(job_title_ids) > 0),
  scope text not null check (scope in ('branch', 'region', 'organisation')),
  same_department boolean not null default false,
  is_active boolean not null default true
);

-- The old HR system's chain, with each step limited to the people who can sensibly approve it.
insert into public.leave_approval_steps (step_order, name, job_title_ids, scope, same_department)
select s.step_order, s.name, array(select id from public.job_titles where name = any (s.titles)), s.scope, s.same_department
from (values
  (1, 'Supervisor', array['Supervisor'], 'branch', true),
  (2, 'Branch or Marketing Manager', array['Branch Manager', 'Marketing Manager'], 'branch', false),
  (3, 'Regional Manager', array['Regional Manager', 'Assistant Regional Manager'], 'region', false),
  (4, 'Business Development Manager', array['Business Development Manager'], 'organisation', false),
  (5, 'HR', array['HR Officer', 'Head of HR'], 'organisation', false)
) as s(step_order, name, titles, scope, same_department);

-- ---------------------------------------------------------------------------
-- Requests
-- ---------------------------------------------------------------------------

create type public.leave_status as enum ('pending', 'approved', 'rejected', 'cancelled');
create sequence public.leave_request_seq;

-- Employees may attach their own evidence (a medical certificate) to a request.
create policy "staff upload their own leave evidence" on public.employee_documents for insert to authenticated
  with check (app.is_own_employee_record(employee_id) and document_type in ('medical_report', 'other'));
create policy "staff upload their own evidence files" on storage.objects for insert to authenticated
  with check (bucket_id = 'hr-documents' and app.is_own_employee_record(app.storage_path_employee(name)));

create table public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  request_no text not null unique,
  employee_id uuid not null references public.employees (id) on delete restrict,
  -- Where the employee worked when they asked, which decides who approves.
  branch_id uuid not null references public.branches (id),
  department_code text not null references public.departments (code),
  leave_type_id uuid not null references public.leave_types (id),
  start_date date not null,
  end_date date not null,
  days integer not null check (days > 0),
  reason text,
  relief_employee_id uuid references public.employees (id),
  document_id uuid references public.employee_documents (id),
  status public.leave_status not null default 'pending',
  decision_note text,
  decided_at timestamptz,
  requested_by uuid not null references public.staff (id),
  requested_at timestamptz not null default now(),
  cancelled_at timestamptz,
  constraint leave_requests_dates check (end_date >= start_date)
);
create index leave_requests_employee_idx on public.leave_requests (employee_id, start_date);
create index leave_requests_branch_status_idx on public.leave_requests (branch_id, status);
create index leave_requests_dates_idx on public.leave_requests (start_date, end_date) where status = 'approved';

create table public.leave_request_steps (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.leave_requests (id) on delete restrict,
  step_order integer not null,
  kind text not null check (kind in ('relief', 'chain', 'hr')),
  name text not null,
  job_title_ids uuid[],
  scope text,
  same_department boolean not null default false,
  status text not null check (status in ('waiting', 'pending', 'approved', 'rejected', 'skipped')),
  acted_by uuid references public.staff (id),
  acted_at timestamptz,
  comment text,
  unique (request_id, step_order)
);

-- Only the workflow functions below write requests and steps.
create or replace function app.leave_guard()
returns trigger
language plpgsql
as $$
begin
  if not app.in_workflow() then
    raise exception 'leave requests change only through requesting, approving and cancelling'
      using errcode = 'insufficient_privilege';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger leave_requests_guard before insert or update or delete on public.leave_requests
  for each row execute function app.leave_guard();
create trigger leave_request_steps_guard before insert or update or delete on public.leave_request_steps
  for each row execute function app.leave_guard();

-- The current employee record behind a staff login, if any.
create or replace function app.employee_of(p_staff_id uuid)
returns public.employees
language sql
stable
security definer
set search_path = ''
as $$
  select * from public.employees where staff_id = p_staff_id and status in ('probation', 'active');
$$;
revoke all on function app.employee_of(uuid) from public, anon, authenticated;

-- True when the employee may approve the step of the request: holds one of its job titles in the right place,
-- is still working here, and isn't the person on leave.
create or replace function app.employee_can_approve_step(p_employee public.employees, p_step public.leave_request_steps, p_request public.leave_requests)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_employee.id is not null
    and p_employee.status in ('probation', 'active')
    and p_employee.id <> p_request.employee_id
    and case p_step.kind
      when 'relief' then p_employee.id = p_request.relief_employee_id
      when 'hr' then p_employee.staff_id is not null
        and app.staff_has_branch_permission(p_employee.staff_id, 'hr.approve', p_request.branch_id)
      else p_employee.job_title_id = any (p_step.job_title_ids)
        and (not p_step.same_department or p_employee.department_code = p_request.department_code)
        and case p_step.scope
          when 'branch' then p_employee.branch_id = p_request.branch_id
          when 'region' then (select region_id from public.branches where id = p_employee.branch_id)
                           = (select region_id from public.branches where id = p_request.branch_id)
          else true
        end
    end;
$$;
revoke all on function app.employee_can_approve_step(public.employees, public.leave_request_steps, public.leave_requests)
  from public, anon, authenticated;

-- True when the signed-in staff member may act on the step now.
create or replace function app.can_act_on_leave_step(p_step public.leave_request_steps)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_request public.leave_requests;
  v_me public.employees := app.employee_of(auth.uid());
begin
  if p_step.status <> 'pending' then
    return false;
  end if;
  select * into v_request from public.leave_requests where id = p_step.request_id;
  if v_request.status <> 'pending' then
    return false;
  end if;
  -- The Head of HR's own step doesn't need an employee record, only the permission.
  if p_step.kind = 'hr' then
    return app.has_branch_permission('hr.approve', v_request.branch_id)
      and v_request.employee_id is distinct from v_me.id;
  end if;
  return app.employee_can_approve_step(v_me, p_step, v_request);
end;
$$;
revoke all on function app.can_act_on_leave_step(public.leave_request_steps) from public, anon, authenticated;

-- Who may see a request: HR for the branch, the employee, their relief officer, and anyone who can or did act on it.
create or replace function app.can_see_leave_request(p_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.leave_requests r
    where r.id = p_request_id
      and (
        app.has_branch_permission('hr.read', r.branch_id)
        or app.is_own_employee_record(r.employee_id)
        or app.is_own_employee_record(r.relief_employee_id)
        or exists (
          select 1 from public.leave_request_steps s
          where s.request_id = r.id and (s.acted_by = auth.uid() or app.can_act_on_leave_step(s))
        )
      )
  );
$$;
revoke all on function app.can_see_leave_request(uuid) from public, anon;
grant execute on function app.can_see_leave_request(uuid) to authenticated;

select app.enable_audit('public.leave_types');
select app.enable_audit('public.public_holidays');
select app.enable_audit('public.leave_approval_steps');
select app.enable_audit('public.leave_requests');
select app.enable_audit('public.leave_request_steps');

alter table public.leave_types enable row level security;
alter table public.public_holidays enable row level security;
alter table public.leave_approval_steps enable row level security;
alter table public.leave_requests enable row level security;
alter table public.leave_request_steps enable row level security;

create policy "staff read leave types" on public.leave_types for select to authenticated using (true);
create policy "hr config adds leave types" on public.leave_types for insert to authenticated
  with check (app.has_permission('hr.config'));
create policy "hr config edits leave types" on public.leave_types for update to authenticated
  using (app.has_permission('hr.config')) with check (app.has_permission('hr.config'));

create policy "staff read public holidays" on public.public_holidays for select to authenticated using (true);
create policy "hr config adds holidays" on public.public_holidays for insert to authenticated
  with check (app.has_permission('hr.config'));
create policy "hr config removes holidays" on public.public_holidays for delete to authenticated
  using (app.has_permission('hr.config'));

create policy "staff read the approval chain" on public.leave_approval_steps for select to authenticated using (true);
create policy "hr config adds steps" on public.leave_approval_steps for insert to authenticated
  with check (app.has_permission('hr.config'));
create policy "hr config edits steps" on public.leave_approval_steps for update to authenticated
  using (app.has_permission('hr.config')) with check (app.has_permission('hr.config'));
-- Steps are switched off rather than deleted, so old requests still read correctly.

create policy "people involved see leave requests" on public.leave_requests for select to authenticated
  using (app.can_see_leave_request(id));
create policy "people involved see leave steps" on public.leave_request_steps for select to authenticated
  using (app.can_see_leave_request(request_id));

-- ---------------------------------------------------------------------------
-- Balances
-- ---------------------------------------------------------------------------

-- A year's entitlement of a leave type for an employee: pro-rated in the year they join, plus long-service days
-- counted on completed years at the start of the year.
create or replace function app.leave_entitlement(p_employee public.employees, p_type public.leave_types, p_year integer)
returns integer
language plpgsql
stable
set search_path = ''
as $$
declare
  v_year_start date := make_date(p_year, 1, 1);
  v_years integer;
  v_days integer := p_type.days_per_year;
begin
  if p_employee.hire_date > make_date(p_year, 12, 31) then
    return 0;
  end if;
  v_years := extract(year from age(v_year_start, p_employee.hire_date))::integer;
  if v_years >= 10 then
    v_days := v_days + p_type.extra_days_after_10_years;
  elsif v_years >= 5 then
    v_days := v_days + p_type.extra_days_after_5_years;
  end if;
  if p_type.prorate and p_employee.hire_date > v_year_start then
    v_days := floor(v_days * (13 - extract(month from p_employee.hire_date)) / 12.0)::integer;
  end if;
  return v_days;
end;
$$;

-- Each leave type's entitlement, days taken, days waiting for approval and days left in a year.
-- Visible to the employee, HR for their branch, and the approvers of their requests.
create or replace function public.leave_balances(p_employee_id uuid, p_year integer default extract(year from current_date)::integer)
returns table (
  leave_type_id uuid, name text, uses_balance boolean, entitlement integer, taken integer, pending integer, available integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_employee public.employees;
begin
  select * into v_employee from public.employees where id = p_employee_id;
  if not found
     or not (
       app.has_branch_permission('hr.read', v_employee.branch_id)
       or app.is_own_employee_record(p_employee_id)
       or exists (select 1 from public.leave_requests r where r.employee_id = p_employee_id and r.status = 'pending'
                  and app.can_see_leave_request(r.id))
     ) then
    return;
  end if;

  return query
  select t.id, t.name, t.uses_balance,
         app.leave_entitlement(v_employee, t, p_year),
         coalesce(sum(r.days) filter (where r.status = 'approved'), 0)::integer,
         coalesce(sum(r.days) filter (where r.status = 'pending'), 0)::integer,
         case when t.uses_balance then
           app.leave_entitlement(v_employee, t, p_year) - coalesce(sum(r.days) filter (where r.status in ('approved', 'pending')), 0)::integer
         end
  from public.leave_types t
  left join public.leave_requests r
    on r.leave_type_id = t.id and r.employee_id = p_employee_id and extract(year from r.start_date) = p_year
  where (t.is_active or r.id is not null)
    and (t.only_for_gender is null or t.only_for_gender = v_employee.gender)
  group by t.id
  order by t.sort_order, t.name;
end;
$$;

-- ---------------------------------------------------------------------------
-- Workflow
-- ---------------------------------------------------------------------------

-- Moves a request to its next step that is still waiting, or approves it when none is left.
create or replace function app.advance_leave_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_next uuid;
begin
  select id into v_next from public.leave_request_steps
  where request_id = p_request_id and status = 'waiting'
  order by step_order limit 1;
  if v_next is null then
    update public.leave_requests set status = 'approved', decided_at = now() where id = p_request_id;
  else
    update public.leave_request_steps set status = 'pending' where id = v_next;
  end if;
end;
$$;
revoke all on function app.advance_leave_request(uuid) from public, anon, authenticated;

-- Asks for leave. Employees ask for themselves; HR (hr.manage) can record a request for someone else, including
-- leave already taken.
create or replace function public.request_leave(
  p_leave_type_id uuid,
  p_start date,
  p_end date,
  p_reason text,
  p_relief_employee_id uuid default null,
  p_document_id uuid default null,
  p_employee_id uuid default null
)
returns public.leave_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee public.employees;
  v_type public.leave_types;
  v_request public.leave_requests;
  v_days integer;
  v_available integer;
  v_on_behalf boolean := p_employee_id is not null;
  v_step public.leave_approval_steps;
  v_order integer := 0;
  v_row public.leave_request_steps;
  v_any_open boolean := false;
begin
  if v_on_behalf then
    select * into v_employee from public.employees where id = p_employee_id for update;
    if not found or not app.has_branch_permission('hr.manage', v_employee.branch_id) then
      raise exception 'employee not found' using errcode = 'no_data_found';
    end if;
  else
    select * into v_employee from public.employees where staff_id = auth.uid() for update;
    if not found then
      raise exception 'your login isn''t linked to an employee record; ask HR' using errcode = 'no_data_found';
    end if;
  end if;
  if v_employee.status not in ('probation', 'active') then
    raise exception 'only current employees can take leave' using errcode = 'check_violation';
  end if;

  select * into v_type from public.leave_types where id = p_leave_type_id and is_active;
  if not found then
    raise exception 'that kind of leave isn''t available' using errcode = 'check_violation';
  end if;
  if v_type.only_for_gender is not null and v_employee.gender is distinct from v_type.only_for_gender then
    raise exception '% isn''t available to this employee', lower(v_type.name) using errcode = 'check_violation';
  end if;

  if p_start is null or p_end is null or p_end < p_start then
    raise exception 'the leave must end on or after the day it starts' using errcode = 'check_violation';
  end if;
  if not v_on_behalf and p_start < current_date then
    raise exception 'leave can''t start in the past; ask HR to record leave already taken' using errcode = 'check_violation';
  end if;
  if extract(year from p_start) <> extract(year from p_end) then
    raise exception 'split leave that crosses into a new year into two requests' using errcode = 'check_violation';
  end if;
  if p_start < v_employee.hire_date then
    raise exception 'leave can''t start before the hire date' using errcode = 'check_violation';
  end if;

  v_days := app.working_days(p_start, p_end);
  if v_days = 0 then
    raise exception 'those dates are all weekends or public holidays' using errcode = 'check_violation';
  end if;
  if v_type.max_days_per_request is not null and v_days > v_type.max_days_per_request then
    raise exception '% can be at most % working days at a time', v_type.name, v_type.max_days_per_request
      using errcode = 'check_violation';
  end if;
  if v_type.document_after_days is not null and v_days > v_type.document_after_days then
    if p_document_id is null then
      raise exception 'attach a supporting document (for example a medical certificate) for % of more than % days',
        lower(v_type.name), v_type.document_after_days using errcode = 'check_violation';
    end if;
  end if;
  if p_document_id is not null
     and not exists (select 1 from public.employee_documents d where d.id = p_document_id and d.employee_id = v_employee.id) then
    raise exception 'that document isn''t on the employee''s file' using errcode = 'check_violation';
  end if;

  if exists (
    select 1 from public.leave_requests r
    where r.employee_id = v_employee.id and r.status in ('pending', 'approved')
      and r.start_date <= p_end and r.end_date >= p_start
  ) then
    raise exception 'these dates overlap leave already requested' using errcode = 'check_violation';
  end if;

  if v_type.uses_balance then
    select coalesce(sum(r.days), 0)::integer into v_available
    from public.leave_requests r
    where r.employee_id = v_employee.id and r.leave_type_id = v_type.id
      and r.status in ('pending', 'approved') and extract(year from r.start_date) = extract(year from p_start);
    v_available := app.leave_entitlement(v_employee, v_type, extract(year from p_start)::integer) - v_available;
    if v_days > v_available then
      raise exception 'that is % working days, but only % days of % are left', v_days, greatest(v_available, 0),
        lower(v_type.name) using errcode = 'check_violation';
    end if;
  end if;

  if p_relief_employee_id is not null then
    if p_relief_employee_id = v_employee.id then
      raise exception 'choose a colleague to cover, not yourself' using errcode = 'check_violation';
    end if;
    if not exists (select 1 from public.employees e where e.id = p_relief_employee_id and e.status in ('probation', 'active')
                   and e.staff_id is not null) then
      raise exception 'the relief officer must be a current employee with an ERP login' using errcode = 'check_violation';
    end if;
  end if;

  perform app.begin_workflow();
  insert into public.leave_requests
    (request_no, employee_id, branch_id, department_code, leave_type_id, start_date, end_date, days, reason,
     relief_employee_id, document_id, requested_by)
  values
    ('LV-' || lpad(nextval('public.leave_request_seq')::text, 6, '0'), v_employee.id, v_employee.branch_id,
     v_employee.department_code, v_type.id, p_start, p_end, v_days, nullif(trim(p_reason), ''),
     p_relief_employee_id, p_document_id, auth.uid())
  returning * into v_request;

  if p_relief_employee_id is not null then
    v_order := v_order + 1;
    insert into public.leave_request_steps (request_id, step_order, kind, name, status)
    values (v_request.id, v_order, 'relief', 'Relief officer', 'waiting');
    v_any_open := true;
  end if;

  for v_step in select * from public.leave_approval_steps where is_active order by step_order loop
    v_order := v_order + 1;
    insert into public.leave_request_steps (request_id, step_order, kind, name, job_title_ids, scope, same_department, status)
    values (v_request.id, v_order, 'chain', v_step.name, v_step.job_title_ids, v_step.scope, v_step.same_department, 'waiting')
    returning * into v_row;
    -- Skip a step nobody can approve: nobody holds the title there with a working login.
    if not exists (
      select 1 from public.employees e
      join public.staff s on s.id = e.staff_id and s.is_active
      where app.employee_can_approve_step(e, v_row, v_request)
    ) then
      update public.leave_request_steps set status = 'skipped', comment = 'Nobody holds this job title here'
       where id = v_row.id;
    else
      v_any_open := true;
    end if;
  end loop;

  -- With no approver anywhere in the chain, the Head of HR decides.
  if not exists (select 1 from public.leave_request_steps where request_id = v_request.id and kind = 'chain' and status = 'waiting') then
    v_order := v_order + 1;
    insert into public.leave_request_steps (request_id, step_order, kind, name, status)
    values (v_request.id, v_order, 'hr', 'Head of HR', 'waiting');
  end if;

  perform app.advance_leave_request(v_request.id);
  perform app.end_workflow();

  select * into v_request from public.leave_requests where id = v_request.id;
  return v_request;
end;
$$;

-- Approves the step of the request the signed-in staff member can act on.
create or replace function public.approve_leave_step(p_request_id uuid, p_comment text default null)
returns public.leave_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_step public.leave_request_steps;
  v_request public.leave_requests;
begin
  select * into v_request from public.leave_requests where id = p_request_id for update;
  select * into v_step from public.leave_request_steps where request_id = p_request_id and status = 'pending';
  if v_request.id is null or v_step.id is null or not app.can_act_on_leave_step(v_step) then
    raise exception 'there is nothing on this request for you to approve' using errcode = 'no_data_found';
  end if;

  perform app.begin_workflow();
  update public.leave_request_steps
     set status = 'approved', acted_by = auth.uid(), acted_at = now(), comment = nullif(trim(p_comment), '')
   where id = v_step.id;
  perform app.advance_leave_request(p_request_id);
  perform app.end_workflow();

  select * into v_request from public.leave_requests where id = p_request_id;
  return v_request;
end;
$$;

create or replace function public.reject_leave_step(p_request_id uuid, p_reason text)
returns public.leave_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_step public.leave_request_steps;
  v_request public.leave_requests;
begin
  select * into v_request from public.leave_requests where id = p_request_id for update;
  select * into v_step from public.leave_request_steps where request_id = p_request_id and status = 'pending';
  if v_request.id is null or v_step.id is null or not app.can_act_on_leave_step(v_step) then
    raise exception 'there is nothing on this request for you to decide' using errcode = 'no_data_found';
  end if;
  if p_reason is null or length(trim(p_reason)) < 3 then
    raise exception 'say why you are turning it down' using errcode = 'check_violation';
  end if;

  perform app.begin_workflow();
  update public.leave_request_steps
     set status = 'rejected', acted_by = auth.uid(), acted_at = now(), comment = trim(p_reason)
   where id = v_step.id;
  update public.leave_request_steps set status = 'skipped' where request_id = p_request_id and status = 'waiting';
  update public.leave_requests set status = 'rejected', decided_at = now(), decision_note = trim(p_reason)
   where id = p_request_id returning * into v_request;
  perform app.end_workflow();
  return v_request;
end;
$$;

-- The Head of HR decides a request outright, whatever step it has reached.
create or replace function public.decide_leave_request(p_request_id uuid, p_approve boolean, p_reason text)
returns public.leave_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.leave_requests;
begin
  select * into v_request from public.leave_requests where id = p_request_id for update;
  if not found or not app.has_branch_permission('hr.approve', v_request.branch_id) then
    raise exception 'leave request not found' using errcode = 'no_data_found';
  end if;
  if app.is_own_employee_record(v_request.employee_id) then
    raise exception 'someone else has to decide your own leave' using errcode = 'insufficient_privilege';
  end if;
  if v_request.status <> 'pending' then
    raise exception 'only pending requests can be decided' using errcode = 'check_violation';
  end if;
  if p_reason is null or length(trim(p_reason)) < 3 then
    raise exception 'give the reason for deciding it directly' using errcode = 'check_violation';
  end if;

  perform app.begin_workflow();
  update public.leave_request_steps
     set status = case when status = 'pending' then case when p_approve then 'approved' else 'rejected' end else 'skipped' end,
         acted_by = case when status = 'pending' then auth.uid() end,
         acted_at = case when status = 'pending' then now() end,
         comment = case when status = 'pending' then 'Decided by HR: ' || trim(p_reason) else comment end
   where request_id = p_request_id and status in ('pending', 'waiting');
  update public.leave_requests
     set status = case when p_approve then 'approved' else 'rejected' end::public.leave_status,
         decided_at = now(), decision_note = trim(p_reason)
   where id = p_request_id
   returning * into v_request;
  perform app.end_workflow();
  return v_request;
end;
$$;

-- The employee withdraws a pending request, or one approved that hasn't started. HR can do the same for them.
create or replace function public.cancel_leave_request(p_request_id uuid, p_reason text default null)
returns public.leave_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.leave_requests;
begin
  select * into v_request from public.leave_requests where id = p_request_id for update;
  if not found or not (app.is_own_employee_record(v_request.employee_id) or app.has_branch_permission('hr.manage', v_request.branch_id)) then
    raise exception 'leave request not found' using errcode = 'no_data_found';
  end if;
  if v_request.status = 'pending' or (v_request.status = 'approved' and v_request.start_date > current_date) then
    perform app.begin_workflow();
    update public.leave_request_steps set status = 'skipped' where request_id = p_request_id and status in ('pending', 'waiting');
    update public.leave_requests
       set status = 'cancelled', cancelled_at = now(), decision_note = coalesce(nullif(trim(p_reason), ''), decision_note)
     where id = p_request_id
     returning * into v_request;
    perform app.end_workflow();
    return v_request;
  end if;
  raise exception 'only pending requests, or approved leave that hasn''t started, can be cancelled' using errcode = 'check_violation';
end;
$$;

-- Requests waiting for the signed-in staff member, with what they need to decide.
create or replace function public.my_leave_approvals()
returns table (
  request_id uuid, request_no text, employee_id uuid, employee_name text, job_title text, branch_name text,
  leave_type text, start_date date, end_date date, days integer, reason text, relief_name text, step_name text,
  step_kind text, requested_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.request_no, e.id, e.first_name || ' ' || e.last_name, jt.name, b.name, t.name, r.start_date, r.end_date,
         r.days, r.reason, re.first_name || ' ' || re.last_name, s.name, s.kind, r.requested_at
  from public.leave_request_steps s
  join public.leave_requests r on r.id = s.request_id
  join public.employees e on e.id = r.employee_id
  join public.job_titles jt on jt.id = e.job_title_id
  join public.branches b on b.id = r.branch_id
  join public.leave_types t on t.id = r.leave_type_id
  left join public.employees re on re.id = r.relief_employee_id
  where s.status = 'pending' and r.status = 'pending' and app.can_act_on_leave_step(s)
  order by r.start_date;
$$;

-- Current colleagues with a login, for choosing a relief officer. Names and roles only.
create or replace function public.colleague_options()
returns table (id uuid, full_name text, job_title text, branch_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select e.id, e.first_name || ' ' || e.last_name, jt.name, b.name
  from public.employees e
  join public.job_titles jt on jt.id = e.job_title_id
  join public.branches b on b.id = e.branch_id
  where e.status in ('probation', 'active') and e.staff_id is not null
    and (exists (select 1 from public.employees me where me.staff_id = auth.uid()) or app.has_permission('hr.manage'))
  order by e.first_name, e.last_name;
$$;

-- ---------------------------------------------------------------------------
-- Function grants
-- ---------------------------------------------------------------------------

revoke all on function public.leave_balances(uuid, integer) from public, anon;
revoke all on function public.request_leave(uuid, date, date, text, uuid, uuid, uuid) from public, anon;
revoke all on function public.approve_leave_step(uuid, text) from public, anon;
revoke all on function public.reject_leave_step(uuid, text) from public, anon;
revoke all on function public.decide_leave_request(uuid, boolean, text) from public, anon;
revoke all on function public.cancel_leave_request(uuid, text) from public, anon;
revoke all on function public.my_leave_approvals() from public, anon;
revoke all on function public.colleague_options() from public, anon;

grant execute on function public.leave_balances(uuid, integer) to authenticated;
grant execute on function public.request_leave(uuid, date, date, text, uuid, uuid, uuid) to authenticated;
grant execute on function public.approve_leave_step(uuid, text) to authenticated;
grant execute on function public.reject_leave_step(uuid, text) to authenticated;
grant execute on function public.decide_leave_request(uuid, boolean, text) to authenticated;
grant execute on function public.cancel_leave_request(uuid, text) to authenticated;
grant execute on function public.my_leave_approvals() to authenticated;
grant execute on function public.colleague_options() to authenticated;
