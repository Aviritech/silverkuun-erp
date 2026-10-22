-- Human Resources, part 3: payroll.
--
-- How a month's pay moves through the system
--   salaries (proposed ──approve──▶ approved) ─┐
--   deductions and one-off adjustments ────────┼─▶ payroll run: draft ──submit──▶ submitted ──approve──▶ approved
--   approved commission ───────────────────────┘        ▲                            │            (posted to the ledger)
--                                                       └────────── return ──────────┘
--
--   * A salary takes effect from the first of a month, and only once someone other than the proposer approves it.
--   * The run works out every employee's pay in the database, so the figures on screen, on the payslip and in the
--     ledger are the same: pay is pro-rated for people who joined or left during the month; pension (employee and
--     employer) is on basic, housing and transport; NHF is on basic; PAYE uses the bands in force, after pension, NHF
--     and rent relief; one-off pay (commission, bonuses) is taxed at the rate it actually adds.
--   * The rates and PAYE bands are settings with a start date, kept by the Financial Controller. They start with the
--     Nigeria Tax Act 2025 bands and the Pension Reform Act rates; confirm them with your tax adviser.
--   * The Financial Controller approves the run; nobody approves a run they prepared or submitted. Approval posts one
--     journal per branch: staff costs by department, against net pay, PAYE, pension, NHF and deductions payable.
--     Accounts then pays salaries and remits PAYE, pension and NHF as ordinary payments against those liabilities.
--   * Employees see their own payslips once the run is approved.

-- ---------------------------------------------------------------------------
-- Permissions and roles
-- ---------------------------------------------------------------------------

insert into public.permissions (code, description) values
  ('payroll.read', 'View salaries, payroll runs and payslips'),
  ('payroll.prepare', 'Propose salaries, set up deductions, and prepare and submit payroll runs'),
  ('payroll.salaries.approve', 'Approve salaries proposed by someone else'),
  ('payroll.approve', 'Approve a submitted payroll run, which posts it to the ledger'),
  ('payroll.config', 'Keep the PAYE bands and the pension, NHF and rent relief rates');

insert into public.roles (code, department_code, name, description) values
  ('payroll_officer', 'hr', 'Payroll Officer', 'Proposes salaries, keeps deductions and prepares the monthly payroll');

insert into public.role_permissions (role_code, permission_code) values
  ('payroll_officer', 'module.hr'),
  ('payroll_officer', 'hr.read'),
  ('payroll_officer', 'payroll.read'),
  ('payroll_officer', 'payroll.prepare'),
  ('head_of_hr', 'payroll.read'),
  ('head_of_hr', 'payroll.prepare'),
  ('head_of_hr', 'payroll.salaries.approve'),
  -- The Financial Controller approves the money side and owns the tax settings.
  ('financial_controller', 'module.hr'),
  ('financial_controller', 'payroll.read'),
  ('financial_controller', 'payroll.salaries.approve'),
  ('financial_controller', 'payroll.approve'),
  ('financial_controller', 'payroll.config'),
  ('internal_auditor', 'payroll.read');

-- ---------------------------------------------------------------------------
-- What each employee's pay depends on
-- ---------------------------------------------------------------------------

alter table public.employees
  -- For rent relief: 20% of the rent the employee pays, up to the cap. Keep the tenancy agreement on their file.
  add column annual_rent numeric(14, 2) check (annual_rent >= 0),
  add column pension_applies boolean not null default true,
  add column nhf_applies boolean not null default true;

-- Ledger accounts for the statutory deductions held until they are remitted.
insert into public.ledger_accounts (code, name, account_type, parent_code, is_group, cash_flow_class, description) values
  ('2241', 'Pension contributions payable', 'liability', '2200', false, 'operating', 'Employee and employer pension due to PFAs'),
  ('2242', 'NHF contributions payable', 'liability', '2200', false, 'operating', 'National Housing Fund deductions due to FMBN');

insert into public.posting_rules (transaction_type, name, direction, debit_account, credit_account, interest_account, requires_member, sort_order) values
  ('salary_payment', 'Net salaries paid (from an approved payroll)', 'payment', '2230', null, null, false, 155),
  ('pension_remittance', 'Pension remitted to PFAs', 'payment', '2241', null, null, false, 201),
  ('nhf_remittance', 'NHF remitted to FMBN', 'payment', '2242', null, null, false, 202);

-- ---------------------------------------------------------------------------
-- Salaries
-- ---------------------------------------------------------------------------

create table public.employee_salaries (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees (id) on delete restrict,
  effective_from date not null check (extract(day from effective_from) = 1),
  basic numeric(14, 2) not null check (basic >= 0),
  housing numeric(14, 2) not null default 0 check (housing >= 0),
  transport numeric(14, 2) not null default 0 check (transport >= 0),
  medical numeric(14, 2) not null default 0 check (medical >= 0),
  utility numeric(14, 2) not null default 0 check (utility >= 0),
  other_allowance numeric(14, 2) not null default 0 check (other_allowance >= 0),
  reason text not null check (length(trim(reason)) > 0),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  proposed_by uuid not null default auth.uid() references public.staff (id),
  proposed_at timestamptz not null default now(),
  decided_by uuid references public.staff (id),
  decided_at timestamptz,
  decision_note text
);
create unique index employee_salaries_one_per_month_idx on public.employee_salaries (employee_id, effective_from)
  where status <> 'rejected';

create or replace function app.employee_salaries_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if app.in_workflow() then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    if old.status <> 'pending' then
      raise exception 'decided salaries are kept; propose a new one instead' using errcode = 'insufficient_privilege';
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' then
    raise exception 'a proposed salary can''t be edited; withdraw it and propose again' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from public.employees e where e.id = new.employee_id and e.status in ('probation', 'active')) then
    raise exception 'salaries are set for current employees' using errcode = 'check_violation';
  end if;
  new.status := 'pending';
  new.proposed_by := auth.uid();
  new.proposed_at := now();
  new.decided_by := null;
  new.decided_at := null;
  new.decision_note := null;
  return new;
end;
$$;

create trigger employee_salaries_guard
  before insert or update or delete on public.employee_salaries
  for each row execute function app.employee_salaries_guard();

-- The approved salary in force on a date.
create or replace function app.salary_on(p_employee_id uuid, p_on date)
returns public.employee_salaries
language sql
stable
security definer
set search_path = ''
as $$
  select * from public.employee_salaries
  where employee_id = p_employee_id and status = 'approved' and effective_from <= p_on
  order by effective_from desc
  limit 1;
$$;
revoke all on function app.salary_on(uuid, date) from public, anon, authenticated;

create or replace function public.decide_salary(p_id uuid, p_approve boolean, p_note text default null)
returns public.employee_salaries
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_salary public.employee_salaries;
begin
  select * into v_salary from public.employee_salaries where id = p_id for update;
  if not found or not app.has_permission('payroll.salaries.approve') then
    raise exception 'salary not found' using errcode = 'no_data_found';
  end if;
  if v_salary.status <> 'pending' then
    raise exception 'this salary has already been decided' using errcode = 'check_violation';
  end if;
  if v_salary.proposed_by = auth.uid() then
    raise exception 'you proposed this salary, so someone else must approve it' using errcode = 'insufficient_privilege';
  end if;
  if app.is_own_employee_record(v_salary.employee_id) then
    raise exception 'someone else has to approve your own salary' using errcode = 'insufficient_privilege';
  end if;
  if not p_approve and (p_note is null or length(trim(p_note)) < 3) then
    raise exception 'say why you are rejecting it' using errcode = 'check_violation';
  end if;

  perform app.begin_workflow();
  update public.employee_salaries
     set status = case when p_approve then 'approved' else 'rejected' end,
         decided_by = auth.uid(), decided_at = now(), decision_note = nullif(trim(p_note), '')
   where id = p_id
   returning * into v_salary;
  perform app.end_workflow();
  return v_salary;
end;
$$;

-- ---------------------------------------------------------------------------
-- Recurring deductions
-- ---------------------------------------------------------------------------

create table public.employee_deductions (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees (id) on delete restrict,
  kind text not null check (kind in ('salary_advance', 'staff_loan', 'cooperative', 'union_dues', 'other')),
  description text not null check (length(trim(description)) > 0),
  monthly_amount numeric(14, 2) not null check (monthly_amount > 0),
  -- Stops once this much has been recovered, such as the amount of an advance. Null runs until it's stopped.
  total_amount numeric(14, 2) check (total_amount > 0),
  start_month date not null check (extract(day from start_month) = 1),
  end_month date check (end_month is null or extract(day from end_month) = 1),
  is_active boolean not null default true,
  created_by uuid not null default auth.uid() references public.staff (id),
  created_at timestamptz not null default now(),
  constraint employee_deductions_months check (end_month is null or end_month >= start_month)
);
create index employee_deductions_employee_idx on public.employee_deductions (employee_id);

-- ---------------------------------------------------------------------------
-- Settings: rates and PAYE bands, each with the month they start
-- ---------------------------------------------------------------------------

create table public.payroll_settings (
  effective_from date primary key check (extract(day from effective_from) = 1),
  pension_employee_rate numeric(5, 2) not null check (pension_employee_rate between 0 and 100),
  pension_employer_rate numeric(5, 2) not null check (pension_employer_rate between 0 and 100),
  nhf_rate numeric(5, 2) not null check (nhf_rate between 0 and 100),
  rent_relief_rate numeric(5, 2) not null check (rent_relief_rate between 0 and 100),
  rent_relief_cap numeric(14, 2) not null check (rent_relief_cap >= 0),
  -- Bands on annual taxable income, lowest first: [{"upto": 800000, "rate": 0}, …, {"upto": null, "rate": 25}].
  paye_bands jsonb not null,
  note text,
  updated_by uuid default auth.uid() references public.staff (id),
  updated_at timestamptz not null default now()
);

create or replace function app.payroll_settings_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_band jsonb;
  v_previous numeric := 0;
  v_count integer := jsonb_array_length(new.paye_bands);
  v_i integer := 0;
begin
  if jsonb_typeof(new.paye_bands) <> 'array' or v_count = 0 then
    raise exception 'give at least one PAYE band' using errcode = 'check_violation';
  end if;
  for v_band in select * from jsonb_array_elements(new.paye_bands) loop
    v_i := v_i + 1;
    if (v_band ->> 'rate') is null or (v_band ->> 'rate')::numeric not between 0 and 100 then
      raise exception 'each PAYE band needs a rate between 0 and 100' using errcode = 'check_violation';
    end if;
    if v_i < v_count then
      if (v_band ->> 'upto') is null or (v_band ->> 'upto')::numeric <= v_previous then
        raise exception 'PAYE band limits must go up, lowest first' using errcode = 'check_violation';
      end if;
      v_previous := (v_band ->> 'upto')::numeric;
    elsif (v_band ->> 'upto') is not null then
      raise exception 'the last PAYE band has no upper limit' using errcode = 'check_violation';
    end if;
  end loop;
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end;
$$;

create trigger payroll_settings_guard
  before insert or update on public.payroll_settings
  for each row execute function app.payroll_settings_guard();

-- Nigeria Tax Act 2025 bands (from January 2026) and Pension Reform Act 2014 minimum rates.
insert into public.payroll_settings
  (effective_from, pension_employee_rate, pension_employer_rate, nhf_rate, rent_relief_rate, rent_relief_cap, paye_bands, note)
values (
  '2026-01-01', 8, 10, 2.5, 20, 500000,
  '[{"upto": 800000, "rate": 0}, {"upto": 3000000, "rate": 15}, {"upto": 12000000, "rate": 18},
    {"upto": 25000000, "rate": 21}, {"upto": 50000000, "rate": 23}, {"upto": null, "rate": 25}]',
  'Nigeria Tax Act 2025 bands; pension 8% employee and 10% employer; NHF 2.5% of basic; rent relief 20% up to N500,000.'
);

-- Annual PAYE on annual taxable income, using the bands given.
create or replace function app.paye_annual(p_taxable numeric, p_bands jsonb)
returns numeric
language plpgsql
immutable
as $$
declare
  v_band jsonb;
  v_lower numeric := 0;
  v_tax numeric := 0;
  v_upper numeric;
begin
  if p_taxable <= 0 then
    return 0;
  end if;
  for v_band in select * from jsonb_array_elements(p_bands) loop
    v_upper := (v_band ->> 'upto')::numeric;
    v_tax := v_tax + greatest(0, least(p_taxable, coalesce(v_upper, p_taxable)) - v_lower) * (v_band ->> 'rate')::numeric / 100;
    exit when v_upper is null or p_taxable <= v_upper;
    v_lower := v_upper;
  end loop;
  return v_tax;
end;
$$;

-- ---------------------------------------------------------------------------
-- Commission waiting to be paid with salaries (raised by the Commissions part of HR)
-- ---------------------------------------------------------------------------

create table public.commission_payouts (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees (id) on delete restrict,
  description text not null,
  amount numeric(14, 2) not null check (amount > 0),
  -- Paid in the first payroll for a month ending on or after this date.
  payable_from date not null,
  status text not null default 'approved' check (status in ('approved', 'paid', 'cancelled')),
  payroll_line_id uuid,
  approved_by uuid references public.staff (id),
  approved_at timestamptz not null default now()
);
create index commission_payouts_employee_idx on public.commission_payouts (employee_id) where status = 'approved';

-- ---------------------------------------------------------------------------
-- Payroll runs
-- ---------------------------------------------------------------------------

create type public.payroll_status as enum ('draft', 'submitted', 'approved', 'cancelled');

create table public.payroll_runs (
  id uuid primary key default gen_random_uuid(),
  period date not null check (extract(day from period) = 1),
  status public.payroll_status not null default 'draft',
  settings_from date not null references public.payroll_settings (effective_from),
  note text,
  return_reason text,
  prepared_by uuid not null references public.staff (id),
  prepared_at timestamptz not null default now(),
  submitted_by uuid references public.staff (id),
  submitted_at timestamptz,
  approved_by uuid references public.staff (id),
  approved_at timestamptz
);
create unique index payroll_runs_one_per_month_idx on public.payroll_runs (period) where status <> 'cancelled';

create table public.payroll_adjustments (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.payroll_runs (id) on delete restrict,
  employee_id uuid not null references public.employees (id) on delete restrict,
  kind text not null check (kind in ('bonus', 'overtime', 'arrears', 'allowance', 'deduction')),
  description text not null check (length(trim(description)) > 0),
  amount numeric(14, 2) not null check (amount > 0),
  -- Deductions come off net pay. Earnings are taxed unless marked otherwise (a reimbursement, for example).
  taxable boolean not null default true,
  created_by uuid not null default auth.uid() references public.staff (id),
  created_at timestamptz not null default now()
);
create index payroll_adjustments_run_idx on public.payroll_adjustments (run_id, employee_id);

create table public.payroll_lines (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.payroll_runs (id) on delete restrict,
  employee_id uuid not null references public.employees (id) on delete restrict,
  branch_id uuid not null references public.branches (id),
  department_code text not null references public.departments (code),
  job_title_id uuid not null references public.job_titles (id),
  days_paid integer not null,
  days_in_month integer not null,
  basic numeric(14, 2) not null,
  housing numeric(14, 2) not null,
  transport numeric(14, 2) not null,
  medical numeric(14, 2) not null,
  utility numeric(14, 2) not null,
  other_allowance numeric(14, 2) not null,
  commission numeric(14, 2) not null,
  extra_taxable numeric(14, 2) not null,
  extra_non_taxable numeric(14, 2) not null,
  gross numeric(14, 2) not null,
  pension_employee numeric(14, 2) not null,
  pension_employer numeric(14, 2) not null,
  nhf numeric(14, 2) not null,
  rent_relief numeric(14, 2) not null,
  -- The year's taxable income this month's pay implies, after reliefs.
  annual_taxable numeric(14, 2) not null,
  paye numeric(14, 2) not null,
  deductions numeric(14, 2) not null,
  net numeric(14, 2) not null check (net >= 0),
  bank_name text,
  bank_account_number text,
  pension_administrator text,
  pension_pin text,
  tax_id text,
  unique (run_id, employee_id)
);
create index payroll_lines_employee_idx on public.payroll_lines (employee_id);

alter table public.commission_payouts
  add constraint commission_payouts_line_fk foreign key (payroll_line_id) references public.payroll_lines (id);

create table public.payroll_line_deductions (
  id uuid primary key default gen_random_uuid(),
  line_id uuid not null references public.payroll_lines (id) on delete cascade,
  deduction_id uuid references public.employee_deductions (id),
  kind text not null,
  description text not null,
  amount numeric(14, 2) not null check (amount > 0)
);
create index payroll_line_deductions_line_idx on public.payroll_line_deductions (line_id);
create index payroll_line_deductions_deduction_idx on public.payroll_line_deductions (deduction_id);

alter table public.journal_entries add column payroll_run_id uuid references public.payroll_runs (id);
alter table public.journal_entries drop constraint journal_entries_source_check;
alter table public.journal_entries
  add constraint journal_entries_source_check check (source in ('manual', 'transaction', 'reversal', 'bill', 'payroll'));

-- Runs, lines, their deductions and commission payouts are written only by the workflow functions.
create or replace function app.payroll_guard()
returns trigger
language plpgsql
as $$
begin
  if not app.in_workflow() then
    raise exception 'payroll changes only through preparing, submitting and approving the run'
      using errcode = 'insufficient_privilege';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger payroll_runs_guard before insert or update or delete on public.payroll_runs
  for each row execute function app.payroll_guard();
create trigger payroll_lines_guard before insert or update or delete on public.payroll_lines
  for each row execute function app.payroll_guard();
create trigger payroll_line_deductions_guard before insert or update or delete on public.payroll_line_deductions
  for each row execute function app.payroll_guard();
create trigger commission_payouts_guard before insert or update or delete on public.commission_payouts
  for each row execute function app.payroll_guard();

-- Adjustments are added and removed while the run is a draft.
create or replace function app.payroll_adjustments_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if app.in_workflow() then
    return coalesce(new, old);
  end if;
  if tg_op = 'UPDATE' then
    raise exception 'remove the adjustment and add it again' using errcode = 'insufficient_privilege';
  end if;
  if (select status from public.payroll_runs where id = coalesce(new.run_id, old.run_id)) <> 'draft' then
    raise exception 'adjustments change only while the run is a draft' using errcode = 'check_violation';
  end if;
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
    if new.kind = 'deduction' then
      new.taxable := false;
    end if;
  end if;
  return coalesce(new, old);
end;
$$;

create trigger payroll_adjustments_guard
  before insert or update or delete on public.payroll_adjustments
  for each row execute function app.payroll_adjustments_guard();

-- ---------------------------------------------------------------------------
-- Working out pay
-- ---------------------------------------------------------------------------

-- People employed for at least a day of the month, whether or not they have a salary yet.
create or replace function app.employed_in(p_period date)
returns setof public.employees
language sql
stable
security definer
set search_path = ''
as $$
  select * from public.employees e
  where e.hire_date <= (p_period + interval '1 month - 1 day')::date
    and (e.exit_date is null or e.exit_date >= p_period);
$$;
revoke all on function app.employed_in(date) from public, anon, authenticated;

-- Rebuilds every line of a draft run from salaries, settings, deductions, adjustments and commission.
create or replace function app.build_payroll_lines(p_run_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.payroll_runs;
  v_settings public.payroll_settings;
  v_month_end date;
  v_days_in_month integer;
  v_employee public.employees;
  v_salary public.employee_salaries;
  v_line public.payroll_lines;
  v_factor numeric;
  v_days integer;
  v_regular numeric;
  v_rent_relief_annual numeric;
  v_taxable_regular numeric;
  v_one_off numeric;
  v_deduction record;
  v_recovered numeric;
  v_amount numeric;
  v_count integer := 0;
begin
  select * into v_run from public.payroll_runs where id = p_run_id;
  select * into v_settings from public.payroll_settings where effective_from = v_run.settings_from;
  v_month_end := (v_run.period + interval '1 month - 1 day')::date;
  v_days_in_month := extract(day from v_month_end)::integer;

  delete from public.payroll_line_deductions where line_id in (select id from public.payroll_lines where run_id = p_run_id);
  delete from public.payroll_lines where run_id = p_run_id;

  for v_employee in select * from app.employed_in(v_run.period) order by employee_no loop
    v_salary := app.salary_on(v_employee.id, v_month_end);
    continue when v_salary.id is null;

    v_days := (least(coalesce(v_employee.exit_date, v_month_end), v_month_end)
               - greatest(v_employee.hire_date, v_run.period)) + 1;
    v_factor := v_days::numeric / v_days_in_month;

    v_line := null;
    v_line.id := gen_random_uuid();
    v_line.run_id := p_run_id;
    v_line.employee_id := v_employee.id;
    v_line.branch_id := v_employee.branch_id;
    v_line.department_code := v_employee.department_code;
    v_line.job_title_id := v_employee.job_title_id;
    v_line.days_paid := v_days;
    v_line.days_in_month := v_days_in_month;
    v_line.basic := round(v_salary.basic * v_factor, 2);
    v_line.housing := round(v_salary.housing * v_factor, 2);
    v_line.transport := round(v_salary.transport * v_factor, 2);
    v_line.medical := round(v_salary.medical * v_factor, 2);
    v_line.utility := round(v_salary.utility * v_factor, 2);
    v_line.other_allowance := round(v_salary.other_allowance * v_factor, 2);

    select coalesce(sum(amount), 0) into v_line.commission from public.commission_payouts
    where employee_id = v_employee.id and status = 'approved' and payroll_line_id is null and payable_from <= v_month_end;
    select coalesce(sum(amount) filter (where kind <> 'deduction' and taxable), 0),
           coalesce(sum(amount) filter (where kind <> 'deduction' and not taxable), 0)
      into v_line.extra_taxable, v_line.extra_non_taxable
    from public.payroll_adjustments where run_id = p_run_id and employee_id = v_employee.id;

    v_regular := v_line.basic + v_line.housing + v_line.transport + v_line.medical + v_line.utility + v_line.other_allowance;
    v_line.gross := v_regular + v_line.commission + v_line.extra_taxable + v_line.extra_non_taxable;

    v_line.pension_employee := case when v_employee.pension_applies
      then round((v_line.basic + v_line.housing + v_line.transport) * v_settings.pension_employee_rate / 100, 2) else 0 end;
    v_line.pension_employer := case when v_employee.pension_applies
      then round((v_line.basic + v_line.housing + v_line.transport) * v_settings.pension_employer_rate / 100, 2) else 0 end;
    v_line.nhf := case when v_employee.nhf_applies then round(v_line.basic * v_settings.nhf_rate / 100, 2) else 0 end;

    -- Regular pay is taxed as if earned all year; one-off pay is taxed at what it adds on top.
    v_rent_relief_annual := least(coalesce(v_employee.annual_rent, 0) * v_settings.rent_relief_rate / 100, v_settings.rent_relief_cap);
    v_line.rent_relief := round(v_rent_relief_annual / 12, 2);
    v_taxable_regular := greatest(0, v_regular * 12 - (v_line.pension_employee + v_line.nhf) * 12 - v_rent_relief_annual);
    v_one_off := v_line.commission + v_line.extra_taxable;
    v_line.annual_taxable := round(v_taxable_regular + v_one_off, 2);
    v_line.paye := round(
      app.paye_annual(v_taxable_regular, v_settings.paye_bands) / 12
      + app.paye_annual(v_taxable_regular + v_one_off, v_settings.paye_bands)
      - app.paye_annual(v_taxable_regular, v_settings.paye_bands), 2);

    v_line.deductions := 0;
    v_line.bank_name := v_employee.bank_name;
    v_line.bank_account_number := v_employee.bank_account_number;
    v_line.pension_administrator := v_employee.pension_administrator;
    v_line.pension_pin := v_employee.pension_pin;
    v_line.tax_id := v_employee.tax_id;
    v_line.net := 0;
    insert into public.payroll_lines select v_line.*;

    -- Recurring deductions, stopping once their total is recovered.
    for v_deduction in
      select d.* from public.employee_deductions d
      where d.employee_id = v_employee.id and d.is_active and d.start_month <= v_run.period
        and (d.end_month is null or d.end_month >= v_run.period)
    loop
      v_amount := v_deduction.monthly_amount;
      if v_deduction.total_amount is not null then
        select coalesce(sum(ld.amount), 0) into v_recovered
        from public.payroll_line_deductions ld
        join public.payroll_lines l on l.id = ld.line_id
        join public.payroll_runs r on r.id = l.run_id
        where ld.deduction_id = v_deduction.id and r.status = 'approved';
        v_amount := least(v_amount, v_deduction.total_amount - v_recovered);
      end if;
      if v_amount > 0 then
        insert into public.payroll_line_deductions (line_id, deduction_id, kind, description, amount)
        values (v_line.id, v_deduction.id, v_deduction.kind, v_deduction.description, v_amount);
      end if;
    end loop;
    insert into public.payroll_line_deductions (line_id, kind, description, amount)
    select v_line.id, 'deduction', a.description, a.amount
    from public.payroll_adjustments a
    where a.run_id = p_run_id and a.employee_id = v_employee.id and a.kind = 'deduction';

    select coalesce(sum(amount), 0) into v_line.deductions from public.payroll_line_deductions where line_id = v_line.id;
    v_line.net := v_line.gross - v_line.pension_employee - v_line.nhf - v_line.paye - v_line.deductions;
    if v_line.net < 0 then
      raise exception 'deductions for % come to more than their pay this month; reduce them first', v_employee.employee_no
        using errcode = 'check_violation';
    end if;
    update public.payroll_lines set deductions = v_line.deductions, net = v_line.net where id = v_line.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
revoke all on function app.build_payroll_lines(uuid) from public, anon, authenticated;

-- People employed in the month who won't be paid because they have no approved salary.
create or replace function public.payroll_missing_salaries(p_period date)
returns table (employee_id uuid, employee_no text, full_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select e.id, e.employee_no, e.first_name || ' ' || e.last_name
  from app.employed_in(date_trunc('month', p_period)::date) e
  where app.has_permission('payroll.read')
    and (app.salary_on(e.id, (date_trunc('month', p_period) + interval '1 month - 1 day')::date)).id is null
  order by e.employee_no;
$$;

-- ---------------------------------------------------------------------------
-- Workflow
-- ---------------------------------------------------------------------------

create or replace function app.payroll_run_for(p_run_id uuid, p_permission text)
returns public.payroll_runs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.payroll_runs;
begin
  select * into v_run from public.payroll_runs where id = p_run_id for update;
  if not found or not app.has_permission(p_permission) then
    raise exception 'payroll run not found' using errcode = 'no_data_found';
  end if;
  return v_run;
end;
$$;
revoke all on function app.payroll_run_for(uuid, text) from public, anon, authenticated;

create or replace function public.create_payroll_run(p_period date, p_note text default null)
returns public.payroll_runs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.payroll_runs;
  v_period date := date_trunc('month', p_period)::date;
  v_settings date;
begin
  if not app.has_permission('payroll.prepare') then
    raise exception 'you can''t prepare payroll' using errcode = 'insufficient_privilege';
  end if;
  if v_period > date_trunc('month', current_date)::date + interval '1 month' then
    raise exception 'payroll can be prepared up to next month' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.payroll_runs where period = v_period and status <> 'cancelled') then
    raise exception 'there is already a payroll for %', to_char(v_period, 'FMMonth YYYY') using errcode = 'check_violation';
  end if;
  select max(effective_from) into v_settings from public.payroll_settings where effective_from <= v_period;
  if v_settings is null then
    raise exception 'there are no tax and pension settings for %', to_char(v_period, 'FMMonth YYYY') using errcode = 'check_violation';
  end if;

  perform app.begin_workflow();
  insert into public.payroll_runs (period, status, settings_from, note, prepared_by)
  values (v_period, 'draft', v_settings, nullif(trim(p_note), ''), auth.uid())
  returning * into v_run;
  perform app.build_payroll_lines(v_run.id);
  perform app.end_workflow();
  return v_run;
end;
$$;

-- Picks up salary, deduction, adjustment and commission changes made since the run was prepared.
create or replace function public.recalculate_payroll_run(p_run_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.payroll_runs := app.payroll_run_for(p_run_id, 'payroll.prepare');
  v_count integer;
begin
  if v_run.status <> 'draft' then
    raise exception 'only a draft payroll can be recalculated' using errcode = 'check_violation';
  end if;
  perform app.begin_workflow();
  update public.payroll_runs
     set settings_from = (select max(effective_from) from public.payroll_settings where effective_from <= v_run.period)
   where id = p_run_id;
  v_count := app.build_payroll_lines(p_run_id);
  perform app.end_workflow();
  return v_count;
end;
$$;

create or replace function public.submit_payroll_run(p_run_id uuid)
returns public.payroll_runs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.payroll_runs := app.payroll_run_for(p_run_id, 'payroll.prepare');
begin
  if v_run.status <> 'draft' then
    raise exception 'only a draft payroll can be submitted' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.payroll_lines where run_id = p_run_id) then
    raise exception 'nobody is on this payroll yet; approve their salaries first' using errcode = 'check_violation';
  end if;
  perform app.begin_workflow();
  -- Recalculate once more, so what is approved is exactly what the figures are today.
  perform app.build_payroll_lines(p_run_id);
  update public.payroll_runs
     set status = 'submitted', submitted_by = auth.uid(), submitted_at = now(), return_reason = null
   where id = p_run_id
   returning * into v_run;
  perform app.end_workflow();
  return v_run;
end;
$$;

create or replace function public.return_payroll_run(p_run_id uuid, p_reason text)
returns public.payroll_runs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.payroll_runs := app.payroll_run_for(p_run_id, 'payroll.approve');
begin
  if v_run.status <> 'submitted' then
    raise exception 'only a submitted payroll can be returned' using errcode = 'check_violation';
  end if;
  if p_reason is null or length(trim(p_reason)) < 3 then
    raise exception 'say what needs correcting' using errcode = 'check_violation';
  end if;
  perform app.begin_workflow();
  update public.payroll_runs set status = 'draft', return_reason = trim(p_reason), submitted_by = null, submitted_at = null
   where id = p_run_id returning * into v_run;
  perform app.end_workflow();
  return v_run;
end;
$$;

create or replace function public.cancel_payroll_run(p_run_id uuid)
returns public.payroll_runs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.payroll_runs := app.payroll_run_for(p_run_id, 'payroll.prepare');
begin
  if v_run.status <> 'draft' then
    raise exception 'only a draft payroll can be cancelled' using errcode = 'check_violation';
  end if;
  perform app.begin_workflow();
  update public.payroll_runs set status = 'cancelled' where id = p_run_id returning * into v_run;
  perform app.end_workflow();
  return v_run;
end;
$$;

-- Approves the run, pays out the commission it includes, and posts one journal per branch.
create or replace function public.approve_payroll_run(p_run_id uuid)
returns public.payroll_runs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.payroll_runs := app.payroll_run_for(p_run_id, 'payroll.approve');
  v_month_end date;
  v_branch uuid;
  v_entry_id uuid;
  v_line_no integer;
  v_total record;
  v_description text;
begin
  if v_run.status <> 'submitted' then
    raise exception 'only a submitted payroll can be approved' using errcode = 'check_violation';
  end if;
  if auth.uid() in (v_run.prepared_by, v_run.submitted_by) then
    raise exception 'you prepared this payroll, so someone else must approve it' using errcode = 'insufficient_privilege';
  end if;
  v_month_end := (v_run.period + interval '1 month - 1 day')::date;
  v_description := 'Payroll for ' || to_char(v_run.period, 'FMMonth YYYY');

  perform app.begin_workflow();
  -- Only the commission the figures include: it was worked out when the run was submitted, so anything approved
  -- since then waits for next month's payroll.
  update public.commission_payouts c
     set status = 'paid', payroll_line_id = l.id
    from public.payroll_lines l
   where l.run_id = p_run_id and l.employee_id = c.employee_id
     and c.status = 'approved' and c.payroll_line_id is null and c.payable_from <= v_month_end
     and c.approved_at <= v_run.submitted_at;

  for v_branch in select distinct branch_id from public.payroll_lines where run_id = p_run_id loop
    insert into public.journal_entries (branch_id, entry_date, description, source, payroll_run_id, status, created_by, posted_by, posted_at)
    values (v_branch, least(v_month_end, current_date), v_description, 'payroll', p_run_id, 'draft', v_run.prepared_by, auth.uid(), now())
    returning id into v_entry_id;
    v_line_no := 0;

    -- Staff costs by department: everything earned plus the employer's pension.
    for v_total in
      select department_code, sum(gross + pension_employer) as amount
      from public.payroll_lines where run_id = p_run_id and branch_id = v_branch
      group by department_code having sum(gross + pension_employer) > 0
    loop
      v_line_no := v_line_no + 1;
      insert into public.journal_lines (entry_id, line_no, account_code, debit, department_code, description)
      values (v_entry_id, v_line_no, '5200', v_total.amount, v_total.department_code, v_description);
    end loop;

    for v_total in
      select account_code, sum(amount) as amount, label from (
        select '2230' as account_code, net as amount, 'Net pay due' as label from public.payroll_lines where run_id = p_run_id and branch_id = v_branch
        union all
        select '2240', paye, 'PAYE' from public.payroll_lines where run_id = p_run_id and branch_id = v_branch
        union all
        select '2241', pension_employee + pension_employer, 'Pension' from public.payroll_lines where run_id = p_run_id and branch_id = v_branch
        union all
        select '2242', nhf, 'NHF' from public.payroll_lines where run_id = p_run_id and branch_id = v_branch
        union all
        select case when ld.kind = 'salary_advance' then '1320' else '2250' end, ld.amount,
               case when ld.kind = 'salary_advance' then 'Staff advances recovered' else 'Deductions payable' end
        from public.payroll_line_deductions ld
        join public.payroll_lines l on l.id = ld.line_id
        where l.run_id = p_run_id and l.branch_id = v_branch
      ) credits
      group by account_code, label
      having sum(amount) > 0
      order by account_code
    loop
      v_line_no := v_line_no + 1;
      insert into public.journal_lines (entry_id, line_no, account_code, credit, description)
      values (v_entry_id, v_line_no, v_total.account_code, v_total.amount, v_description || ': ' || v_total.label);
    end loop;

    if v_line_no = 0 then
      delete from public.journal_entries where id = v_entry_id;
    else
      perform app.assert_balanced(v_entry_id);
      update public.journal_entries set status = 'posted' where id = v_entry_id;
    end if;
  end loop;

  update public.payroll_runs set status = 'approved', approved_by = auth.uid(), approved_at = now()
   where id = p_run_id returning * into v_run;
  perform app.end_workflow();
  return v_run;
end;
$$;

-- ---------------------------------------------------------------------------
-- Audit and row level security
-- ---------------------------------------------------------------------------

select app.enable_audit('public.employee_salaries');
select app.enable_audit('public.employee_deductions');
select app.enable_audit('public.payroll_settings');
select app.enable_audit('public.commission_payouts');
select app.enable_audit('public.payroll_runs');
select app.enable_audit('public.payroll_adjustments');
select app.enable_audit('public.payroll_lines');

alter table public.employee_salaries enable row level security;
alter table public.employee_deductions enable row level security;
alter table public.payroll_settings enable row level security;
alter table public.commission_payouts enable row level security;
alter table public.payroll_runs enable row level security;
alter table public.payroll_adjustments enable row level security;
alter table public.payroll_lines enable row level security;
alter table public.payroll_line_deductions enable row level security;

create policy "payroll readers see salaries" on public.employee_salaries for select to authenticated
  using (app.has_permission('payroll.read') or (status = 'approved' and app.is_own_employee_record(employee_id)));
create policy "payroll preparers propose salaries" on public.employee_salaries for insert to authenticated
  with check (app.has_permission('payroll.prepare'));
create policy "payroll preparers withdraw proposals" on public.employee_salaries for delete to authenticated
  using (app.has_permission('payroll.prepare') and proposed_by = auth.uid());

create policy "payroll readers see deductions" on public.employee_deductions for select to authenticated
  using (app.has_permission('payroll.read') or app.is_own_employee_record(employee_id));
create policy "payroll preparers add deductions" on public.employee_deductions for insert to authenticated
  with check (app.has_permission('payroll.prepare'));
create policy "payroll preparers change deductions" on public.employee_deductions for update to authenticated
  using (app.has_permission('payroll.prepare')) with check (app.has_permission('payroll.prepare'));

create policy "payroll readers see settings" on public.payroll_settings for select to authenticated
  using (app.has_permission('payroll.read') or app.has_permission('payroll.config'));
create policy "payroll config adds settings" on public.payroll_settings for insert to authenticated
  with check (app.has_permission('payroll.config'));
create policy "payroll config changes settings" on public.payroll_settings for update to authenticated
  using (app.has_permission('payroll.config')
         and not exists (select 1 from public.payroll_runs r where r.settings_from = effective_from and r.status = 'approved'))
  with check (app.has_permission('payroll.config'));

create policy "payroll readers see commission payouts" on public.commission_payouts for select to authenticated
  using (app.has_permission('payroll.read') or app.is_own_employee_record(employee_id));

create policy "payroll readers see runs" on public.payroll_runs for select to authenticated
  using (
    app.has_permission('payroll.read')
    or (status = 'approved' and exists (
      select 1 from public.payroll_lines l where l.run_id = payroll_runs.id and app.is_own_employee_record(l.employee_id)
    ))
  );

create policy "payroll readers see adjustments" on public.payroll_adjustments for select to authenticated
  using (app.has_permission('payroll.read'));
create policy "payroll preparers add adjustments" on public.payroll_adjustments for insert to authenticated
  with check (app.has_permission('payroll.prepare'));
create policy "payroll preparers remove adjustments" on public.payroll_adjustments for delete to authenticated
  using (app.has_permission('payroll.prepare'));

-- Employees see their own payslip once the run is approved.
create or replace function app.is_own_approved_payslip(p_line_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.payroll_lines l join public.payroll_runs r on r.id = l.run_id
    where l.id = p_line_id and r.status = 'approved' and app.is_own_employee_record(l.employee_id)
  );
$$;
revoke all on function app.is_own_approved_payslip(uuid) from public, anon;
grant execute on function app.is_own_approved_payslip(uuid) to authenticated;

create policy "payroll readers and payees see lines" on public.payroll_lines for select to authenticated
  using (app.has_permission('payroll.read') or app.is_own_approved_payslip(id));
create policy "payroll readers and payees see line deductions" on public.payroll_line_deductions for select to authenticated
  using (app.has_permission('payroll.read') or app.is_own_approved_payslip(line_id));

-- ---------------------------------------------------------------------------
-- Function grants
-- ---------------------------------------------------------------------------

revoke all on function public.decide_salary(uuid, boolean, text) from public, anon;
revoke all on function public.payroll_missing_salaries(date) from public, anon;
revoke all on function public.create_payroll_run(date, text) from public, anon;
revoke all on function public.recalculate_payroll_run(uuid) from public, anon;
revoke all on function public.submit_payroll_run(uuid) from public, anon;
revoke all on function public.return_payroll_run(uuid, text) from public, anon;
revoke all on function public.cancel_payroll_run(uuid) from public, anon;
revoke all on function public.approve_payroll_run(uuid) from public, anon;

grant execute on function public.decide_salary(uuid, boolean, text) to authenticated;
grant execute on function public.payroll_missing_salaries(date) to authenticated;
grant execute on function public.create_payroll_run(date, text) to authenticated;
grant execute on function public.recalculate_payroll_run(uuid) to authenticated;
grant execute on function public.submit_payroll_run(uuid) to authenticated;
grant execute on function public.return_payroll_run(uuid, text) to authenticated;
grant execute on function public.cancel_payroll_run(uuid) to authenticated;
grant execute on function public.approve_payroll_run(uuid) to authenticated;
