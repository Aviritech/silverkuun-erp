-- Credit: loan applications, appraisal, management approval, disbursement through Accounts, repayment schedules,
-- arrears, restructuring and reminders. Follows "CREDIT DEPARTMENT: Workflow, Scope of Work & ERP System Requirements".
--
-- How a loan moves through the system
--   draft ──submit──▶ submitted ──appraise──▶ appraised ──approve──▶ approved ──(Accounts pays it)──▶ active ──▶ closed
--     ▲                   │                      │  └──reject──▶ rejected
--     └──── returned ◀────┴──────return──────────┘
--   An approved loan (or a draft) can be cancelled with a reason before any money goes out.
--
--   * The account officer prepares the application with the customer's employment, collateral, guarantors and documents.
--   * A credit analyst records the appraisal (bureau check, risk rating, recommendation). Management approves or rejects.
--     Nobody appraises or approves an application they prepared, and the appraiser can't also approve it.
--   * Money moves only through Accounts: an approved loan becomes a loan disbursement payment request there, and the loan
--     becomes active, with its repayment schedule, when that payment posts. Repayments are Accounts receipts against the
--     loan; the database splits each one between interest and principal from the schedule (interest first within each
--     instalment, oldest instalment first), so the ledger and the loan book always agree.
--   * Schedules, repayments and restructures are written only by the workflow functions and triggers below.
--   * Interest is recognised when it is received (cash basis), which is how the existing posting rule already works.

-- ---------------------------------------------------------------------------
-- Department, permissions and roles
-- ---------------------------------------------------------------------------

insert into public.departments (code, name) values ('credit', 'Credit');

insert into public.permissions (code, description) values
  ('module.credit', 'Open the Credit module'),
  ('credit.read', 'View loan applications, loans, schedules, repayments and credit reports'),
  ('credit.manage', 'Prepare loan applications, upload documents, request restructures and record reminders'),
  ('credit.appraise', 'Record the credit appraisal and risk assessment of an application'),
  ('credit.approve', 'Approve, return, reject or cancel loans, approve restructures and reassign account officers'),
  ('credit.config', 'Manage loan products');

insert into public.roles (code, department_code, name, description) values
  ('credit_officer', 'credit', 'Account Officer', 'Prepares loan applications for a branch, follows up repayments and sends reminders'),
  ('credit_analyst', 'credit', 'Credit Analyst', 'Appraises applications: bureau check, risk rating and recommendation'),
  ('credit_manager', 'credit', 'Head of Credit', 'Approves or rejects loans, approves restructures and owns the loan products');

insert into public.role_permissions (role_code, permission_code) values
  ('credit_officer', 'module.credit'),
  ('credit_officer', 'credit.read'),
  ('credit_officer', 'credit.manage'),
  ('credit_officer', 'members.read'),
  ('credit_analyst', 'module.credit'),
  ('credit_analyst', 'credit.read'),
  ('credit_analyst', 'credit.appraise'),
  ('credit_analyst', 'members.read'),
  ('credit_manager', 'module.credit'),
  ('credit_manager', 'credit.read'),
  ('credit_manager', 'credit.approve'),
  ('credit_manager', 'credit.config'),
  ('credit_manager', 'members.read'),
  -- Credit staff open member files (KYC, plans, contributions) read-only, the way auditors do.
  ('credit_officer', 'module.administration'),
  ('credit_analyst', 'module.administration'),
  ('credit_manager', 'module.administration'),
  -- Auditors read the loan book but can't change it.
  ('internal_auditor', 'module.credit'),
  ('internal_auditor', 'credit.read');

-- True when a given staff member (not necessarily the caller) holds the permission for the branch.
create or replace function app.staff_has_branch_permission(p_staff_id uuid, p_permission text, p_branch_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.staff s
    join public.staff_roles sr on sr.staff_id = s.id
    join public.role_permissions rp on rp.role_code = sr.role_code
    where s.id = p_staff_id and s.is_active and rp.permission_code = p_permission
      and (
        (sr.branch_id is null and sr.region_id is null)
        or sr.branch_id = p_branch_id
        or sr.region_id = (select b.region_id from public.branches b where b.id = p_branch_id)
      )
  );
$$;
revoke all on function app.staff_has_branch_permission(uuid, text, uuid) from public, anon, authenticated;

-- Account officers (holders of credit.manage) and where they work, for choosing an officer and filtering reports.
create or replace function public.credit_officers()
returns table (id uuid, full_name text, branch_id uuid, region_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct s.id, s.full_name, sr.branch_id, sr.region_id
  from public.staff s
  join public.staff_roles sr on sr.staff_id = s.id
  join public.role_permissions rp on rp.role_code = sr.role_code and rp.permission_code = 'credit.manage'
  where s.is_active and (app.has_permission('credit.read') or app.has_permission('accounts.read'))
  order by s.full_name;
$$;

-- ---------------------------------------------------------------------------
-- Loan products
-- ---------------------------------------------------------------------------

create table public.loan_products (
  code text primary key check (code ~ '^[a-z][a-z0-9_]*$'),
  name text not null check (length(trim(name)) > 0),
  description text not null default '',
  interest_rate numeric(7, 4) not null check (interest_rate >= 0 and interest_rate <= 100),
  rate_basis text not null default 'per_month' check (rate_basis in ('per_month', 'per_annum')),
  interest_method text not null default 'flat' check (interest_method in ('flat', 'reducing_balance')),
  min_amount numeric(14, 2) not null default 0 check (min_amount >= 0),
  max_amount numeric(14, 2) check (max_amount is null or max_amount > 0),
  max_tenor_months integer not null default 12 check (max_tenor_months between 1 and 120),
  requires_guarantor boolean not null default true,
  requires_collateral boolean not null default false,
  requires_proforma boolean not null default false,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  constraint loan_products_amounts check (max_amount is null or max_amount >= min_amount)
);

-- Starting products. Rates and limits are placeholders until Kuun confirms its loan policy.
insert into public.loan_products
  (code, name, description, interest_rate, rate_basis, interest_method, min_amount, max_amount, max_tenor_months,
   requires_guarantor, requires_collateral, requires_proforma, sort_order) values
  ('personal', 'Personal loan', 'Salary earners and traders, for personal needs', 2.5, 'per_month', 'flat', 50000, 2000000, 12, true, false, false, 10),
  ('business', 'Business loan', 'Working capital for a member''s business', 3, 'per_month', 'reducing_balance', 100000, 10000000, 18, true, true, false, 20),
  ('asset', 'Asset finance', 'Buying equipment or goods against a proforma invoice', 2.5, 'per_month', 'flat', 100000, 5000000, 12, true, false, true, 30),
  ('salary_advance', 'Salary advance', 'Short advance repaid from the next salaries', 5, 'per_month', 'flat', 20000, 500000, 3, false, false, false, 40);

-- ---------------------------------------------------------------------------
-- Repayment schedules
-- ---------------------------------------------------------------------------

-- How many instalments a loan has.
create or replace function app.loan_periods(p_frequency text, p_tenor_months integer)
returns integer
language sql
immutable
as $$
  select case p_frequency
    when 'monthly' then p_tenor_months
    when 'quarterly' then ceil(p_tenor_months / 3.0)::integer
    when 'weekly' then greatest(1, round(p_tenor_months * 52 / 12.0)::integer)
    else 1
  end;
$$;

-- The due date of instalment k, counting from the first due date. Month steps are taken from that date each time,
-- so a loan starting on the 31st falls due at each month end rather than drifting to the 28th.
create or replace function app.loan_due_date(p_frequency text, p_first_due date, p_k integer)
returns date
language sql
immutable
as $$
  select case p_frequency
    when 'weekly' then p_first_due + 7 * (p_k - 1)
    when 'monthly' then (p_first_due + make_interval(months => p_k - 1))::date
    when 'quarterly' then (p_first_due + make_interval(months => 3 * (p_k - 1)))::date
    else p_first_due
  end;
$$;

-- One period after the start date (or the end of the tenor for a single repayment at the end).
create or replace function app.loan_first_due(p_frequency text, p_start date, p_tenor_months integer)
returns date
language sql
immutable
as $$
  select case p_frequency
    when 'weekly' then p_start + 7
    when 'monthly' then (p_start + interval '1 month')::date
    when 'quarterly' then (p_start + interval '3 months')::date
    else (p_start + make_interval(months => p_tenor_months))::date
  end;
$$;

-- The repayment schedule for a loan. Flat: interest on the full principal for the whole tenor, spread evenly.
-- Reducing balance: equal instalments with interest on the balance still owed. Rounding goes to the last instalment.
create or replace function public.loan_schedule(
  p_principal numeric, p_interest_rate numeric, p_rate_basis text, p_interest_method text, p_frequency text,
  p_tenor_months integer, p_start date, p_first_due date default null
)
returns table (installment_no integer, due_date date, principal_due numeric, interest_due numeric)
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_n integer := app.loan_periods(p_frequency, p_tenor_months);
  v_annual numeric := (case when p_rate_basis = 'per_month' then p_interest_rate * 12 else p_interest_rate end) / 100;
  v_first date := coalesce(p_first_due, app.loan_first_due(p_frequency, p_start, p_tenor_months));
  v_per_year integer;
  v_r numeric;
  v_payment numeric;
  v_balance numeric := p_principal;
  v_total_interest numeric;
  v_principal numeric;
  v_interest numeric;
begin
  if p_principal is null or p_principal <= 0 or p_tenor_months is null or p_tenor_months < 1 then
    return;
  end if;
  v_per_year := case p_frequency when 'weekly' then 52 when 'quarterly' then 4 else 12 end;
  v_r := v_annual / v_per_year;

  if p_interest_method = 'reducing_balance' and p_frequency <> 'end_of_term' and v_r > 0 then
    v_payment := round(p_principal * v_r / (1 - power(1 + v_r, -v_n)), 2);
    for k in 1..v_n loop
      v_interest := round(v_balance * v_r, 2);
      v_principal := case when k = v_n then v_balance else least(v_balance, v_payment - v_interest) end;
      v_balance := v_balance - v_principal;
      installment_no := k;
      due_date := case when p_first_due is null and p_frequency <> 'end_of_term'
        then app.loan_due_date(p_frequency, p_start, k + 1) else app.loan_due_date(p_frequency, v_first, k) end;
      principal_due := v_principal;
      interest_due := v_interest;
      return next;
    end loop;
  else
    v_total_interest := round(p_principal * v_annual * p_tenor_months / 12.0, 2);
    for k in 1..v_n loop
      installment_no := k;
      due_date := case when p_first_due is null and p_frequency <> 'end_of_term'
        then app.loan_due_date(p_frequency, p_start, k + 1) else app.loan_due_date(p_frequency, v_first, k) end;
      principal_due := case when k < v_n then round(p_principal / v_n, 2) else p_principal - round(p_principal / v_n, 2) * (v_n - 1) end;
      interest_due := case when k < v_n then round(v_total_interest / v_n, 2) else v_total_interest - round(v_total_interest / v_n, 2) * (v_n - 1) end;
      return next;
    end loop;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Loans
-- ---------------------------------------------------------------------------

create type public.loan_status as enum (
  'draft', 'submitted', 'appraised', 'returned', 'rejected', 'approved', 'active', 'closed', 'cancelled'
);
create sequence public.loan_no_seq;

create table public.loans (
  id uuid primary key default gen_random_uuid(),
  loan_no text not null unique,
  branch_id uuid not null references public.branches (id) on delete restrict,
  member_id uuid not null references public.members (id) on delete restrict,
  product_code text not null references public.loan_products (code),
  status public.loan_status not null default 'draft',
  account_officer_id uuid not null references public.staff (id),

  -- Customer contact at the time of application (prefilled from the member file).
  phone text not null check (length(trim(phone)) >= 7),
  address text not null check (length(trim(address)) > 0),
  -- Employment or business.
  customer_category text not null check (customer_category in ('salary_earner', 'business_owner', 'self_employed', 'other')),
  employer_name text,
  occupation text,
  employer_address text,
  monthly_income numeric(14, 2) check (monthly_income is null or monthly_income >= 0),

  -- The request.
  amount_requested numeric(14, 2) not null check (amount_requested > 0),
  purpose text not null check (length(trim(purpose)) > 0),
  tenor_months integer not null check (tenor_months between 1 and 120),
  repayment_frequency text not null check (repayment_frequency in ('weekly', 'monthly', 'quarterly', 'end_of_term')),
  interest_rate numeric(7, 4) not null check (interest_rate >= 0 and interest_rate <= 100),
  rate_basis text not null check (rate_basis in ('per_month', 'per_annum')),
  interest_method text not null check (interest_method in ('flat', 'reducing_balance')),
  repayment_mode text not null check (repayment_mode in ('bank_transfer', 'direct_debit', 'salary_deduction', 'cash', 'cheque')),
  first_repayment_date date,

  -- Appraisal and risk assessment.
  bureau_check text check (bureau_check in ('clear', 'adverse', 'no_record', 'not_checked')),
  bureau_name text,
  bureau_score text,
  risk_rating text check (risk_rating in ('low', 'medium', 'high')),
  recommendation text check (recommendation in ('approve', 'decline')),
  recommended_amount numeric(14, 2) check (recommended_amount is null or recommended_amount > 0),
  appraisal_notes text,
  appraised_by uuid references public.staff (id),
  appraised_at timestamptz,

  -- Decision.
  approved_amount numeric(14, 2) check (approved_amount is null or approved_amount > 0),
  approval_note text,
  decision_reason text,
  approved_by uuid references public.staff (id),
  approved_at timestamptz,
  decided_by uuid references public.staff (id),
  decided_at timestamptz,

  -- Disbursement, mirrored from the Accounts payment so Credit staff can follow it without reading the ledger.
  disbursement_txn_id uuid,
  disbursement_txn_no text,
  disbursement_status text,
  disbursed_on date,
  schedule_version integer not null default 0,
  maturity_date date,
  closed_on date,

  created_by uuid not null default auth.uid() references public.staff (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  submitted_by uuid references public.staff (id),
  submitted_at timestamptz
);
create index loans_branch_status_idx on public.loans (branch_id, status);
create index loans_member_idx on public.loans (member_id);
create index loans_officer_idx on public.loans (account_officer_id);
create index loans_disbursed_idx on public.loans (disbursed_on) where disbursed_on is not null;

create or replace function app.loans_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.members;
  v_product public.loan_products;
  v_branch_code text;
begin
  if tg_op = 'UPDATE' and app.in_workflow() then
    new.updated_at := now();
    return new;
  end if;

  if tg_op = 'INSERT' then
    select * into v_member from public.members where id = new.member_id;
    if v_member.status is distinct from 'approved' then
      raise exception 'loans can only be raised for approved members' using errcode = 'check_violation';
    end if;
    select code into v_branch_code from public.branches where id = v_member.branch_id;
    new.branch_id := v_member.branch_id;
    new.loan_no := 'LN-' || v_branch_code || '-' || lpad(nextval('public.loan_no_seq')::text, 6, '0');
    new.status := 'draft';
    new.account_officer_id := coalesce(new.account_officer_id, auth.uid());
    new.created_by := auth.uid();
    new.created_at := now();
    new.submitted_by := null;
    new.submitted_at := null;
  else
    if old.status not in ('draft', 'returned') then
      raise exception 'this loan is % and can''t be edited', old.status using errcode = 'check_violation';
    end if;
    if new.loan_no is distinct from old.loan_no
       or new.branch_id is distinct from old.branch_id
       or new.member_id is distinct from old.member_id
       or new.status is distinct from old.status
       or new.created_by is distinct from old.created_by
       or new.created_at is distinct from old.created_at
       or new.submitted_by is distinct from old.submitted_by
       or new.submitted_at is distinct from old.submitted_at then
      raise exception 'status and approval details change only through the loan workflow' using errcode = 'insufficient_privilege';
    end if;
    new.updated_at := now();
  end if;

  -- Appraisal, decision and disbursement details are written only by the workflow functions.
  new.bureau_check := case when tg_op = 'UPDATE' then old.bureau_check end;
  new.bureau_name := case when tg_op = 'UPDATE' then old.bureau_name end;
  new.bureau_score := case when tg_op = 'UPDATE' then old.bureau_score end;
  new.risk_rating := case when tg_op = 'UPDATE' then old.risk_rating end;
  new.recommendation := case when tg_op = 'UPDATE' then old.recommendation end;
  new.recommended_amount := case when tg_op = 'UPDATE' then old.recommended_amount end;
  new.appraisal_notes := case when tg_op = 'UPDATE' then old.appraisal_notes end;
  new.appraised_by := case when tg_op = 'UPDATE' then old.appraised_by end;
  new.appraised_at := case when tg_op = 'UPDATE' then old.appraised_at end;
  new.approved_amount := null;
  new.approval_note := null;
  new.decision_reason := case when tg_op = 'UPDATE' then old.decision_reason end;
  new.approved_by := null;
  new.approved_at := null;
  new.decided_by := case when tg_op = 'UPDATE' then old.decided_by end;
  new.decided_at := case when tg_op = 'UPDATE' then old.decided_at end;
  new.disbursement_txn_id := null;
  new.disbursement_txn_no := null;
  new.disbursement_status := null;
  new.disbursed_on := null;
  new.schedule_version := 0;
  new.maturity_date := null;
  new.closed_on := null;

  select * into v_product from public.loan_products where code = new.product_code;
  if not v_product.is_active then
    raise exception 'that loan product is not available' using errcode = 'check_violation';
  end if;
  if new.amount_requested < v_product.min_amount or new.amount_requested > coalesce(v_product.max_amount, new.amount_requested) then
    raise exception '% loans are between ₦% and ₦%', v_product.name, v_product.min_amount, coalesce(v_product.max_amount::text, 'no limit')
      using errcode = 'check_violation';
  end if;
  if new.tenor_months > v_product.max_tenor_months then
    raise exception '% loans run for at most % months', v_product.name, v_product.max_tenor_months using errcode = 'check_violation';
  end if;
  if new.repayment_frequency = 'quarterly' and new.tenor_months % 3 <> 0 then
    raise exception 'a quarterly loan''s tenor must be a whole number of quarters' using errcode = 'check_violation';
  end if;
  if new.first_repayment_date is not null and new.first_repayment_date <= current_date then
    raise exception 'the first repayment date must be in the future' using errcode = 'check_violation';
  end if;
  if not app.staff_has_branch_permission(new.account_officer_id, 'credit.manage', new.branch_id) then
    raise exception 'the account officer must be a Credit account officer for this branch' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger loans_guard
  before insert or update on public.loans
  for each row execute function app.loans_guard();

-- ---------------------------------------------------------------------------
-- Guarantors, collateral and documents
-- ---------------------------------------------------------------------------

create table public.loan_guarantors (
  id uuid primary key default gen_random_uuid(),
  loan_id uuid not null references public.loans (id) on delete restrict,
  branch_id uuid not null references public.branches (id),
  full_name text not null check (length(trim(full_name)) > 0),
  phone text not null check (length(trim(phone)) >= 7),
  address text not null check (length(trim(address)) > 0),
  relationship text,
  occupation text,
  employer text,
  monthly_income numeric(14, 2) check (monthly_income is null or monthly_income >= 0),
  is_member boolean not null default false,
  created_by uuid not null default auth.uid() references public.staff (id),
  created_at timestamptz not null default now()
);
create index loan_guarantors_loan_idx on public.loan_guarantors (loan_id);

create table public.loan_collaterals (
  id uuid primary key default gen_random_uuid(),
  loan_id uuid not null references public.loans (id) on delete restrict,
  branch_id uuid not null references public.branches (id),
  collateral_type text not null check (
    collateral_type in ('vehicle', 'land_property', 'equipment', 'stock', 'savings_lien', 'cash_deposit', 'other')
  ),
  description text not null check (length(trim(description)) > 0),
  estimated_value numeric(14, 2) not null check (estimated_value > 0),
  valuation_date date,
  valued_by text,
  created_by uuid not null default auth.uid() references public.staff (id),
  created_at timestamptz not null default now()
);
create index loan_collaterals_loan_idx on public.loan_collaterals (loan_id);

create type public.loan_document_type as enum (
  'application_form', 'proforma_invoice', 'bank_statement', 'payslip', 'guarantor_form', 'collateral_document',
  'credit_bureau_report', 'offer_letter', 'other'
);

create table public.loan_documents (
  id uuid primary key default gen_random_uuid(),
  loan_id uuid not null references public.loans (id) on delete restrict,
  branch_id uuid not null references public.branches (id),
  document_type public.loan_document_type not null,
  file_name text not null,
  storage_path text not null unique,
  mime_type text not null check (mime_type in ('application/pdf', 'image/jpeg', 'image/png')),
  size_bytes integer not null check (size_bytes > 0 and size_bytes <= 10485760),
  uploaded_by uuid not null default auth.uid() references public.staff (id),
  uploaded_at timestamptz not null default now()
);
create index loan_documents_loan_idx on public.loan_documents (loan_id);

-- Guarantors and collateral are part of the application, so they change only while it is a draft or returned.
create or replace function app.loan_parts_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_loan public.loans;
begin
  select * into v_loan from public.loans where id = coalesce(new.loan_id, old.loan_id);
  if v_loan.status not in ('draft', 'returned') then
    raise exception 'guarantors and collateral change only while the application is a draft or returned' using errcode = 'check_violation';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  if tg_op = 'UPDATE' and new.loan_id is distinct from old.loan_id then
    raise exception 'move it by removing and adding it again' using errcode = 'check_violation';
  end if;
  new.branch_id := v_loan.branch_id;
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
  end if;
  return new;
end;
$$;

create trigger loan_guarantors_guard
  before insert or update or delete on public.loan_guarantors
  for each row execute function app.loan_parts_guard();
create trigger loan_collaterals_guard
  before insert or update or delete on public.loan_collaterals
  for each row execute function app.loan_parts_guard();

-- The account officer adds application documents while preparing; the analyst adds the bureau report while appraising;
-- the signed offer letter is added once the loan is approved.
create or replace function app.loan_documents_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_loan public.loans;
begin
  select * into v_loan from public.loans where id = coalesce(new.loan_id, old.loan_id);
  if tg_op = 'DELETE' then
    if v_loan.status not in ('draft', 'returned') then
      raise exception 'documents can only be removed while the application is a draft or returned' using errcode = 'check_violation';
    end if;
    return old;
  end if;

  new.branch_id := v_loan.branch_id;
  new.uploaded_by := auth.uid();
  new.uploaded_at := now();
  if new.storage_path not like v_loan.branch_id::text || '/' || v_loan.id::text || '/%' then
    raise exception 'storage path must sit under the loan''s folder' using errcode = 'check_violation';
  end if;

  if v_loan.status in ('draft', 'returned') then
    if not app.has_branch_permission('credit.manage', v_loan.branch_id)
       and not (new.document_type = 'credit_bureau_report' and app.has_branch_permission('credit.appraise', v_loan.branch_id)) then
      raise exception 'only the account officer adds documents to an application' using errcode = 'insufficient_privilege';
    end if;
  elsif v_loan.status = 'submitted' then
    if new.document_type <> 'credit_bureau_report' or not app.has_branch_permission('credit.appraise', v_loan.branch_id) then
      raise exception 'while the application is being appraised, only the credit analyst can add the bureau report' using errcode = 'check_violation';
    end if;
  elsif v_loan.status in ('approved', 'active', 'closed') then
    if new.document_type not in ('offer_letter', 'other') or not app.has_branch_permission('credit.manage', v_loan.branch_id) then
      raise exception 'once a loan is approved, only the signed offer letter or other correspondence can be added' using errcode = 'check_violation';
    end if;
  else
    raise exception 'documents can''t be added to a % application', v_loan.status using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger loan_documents_guard
  before insert or delete on public.loan_documents
  for each row execute function app.loan_documents_guard();

-- ---------------------------------------------------------------------------
-- Schedule, repayments, restructures and reminders (written only by the workflow)
-- ---------------------------------------------------------------------------

create table public.loan_installments (
  id uuid primary key default gen_random_uuid(),
  loan_id uuid not null references public.loans (id) on delete restrict,
  branch_id uuid not null references public.branches (id),
  -- A restructure starts a new version; earlier versions are kept as history.
  schedule_version integer not null check (schedule_version > 0),
  installment_no integer not null check (installment_no > 0),
  due_date date not null,
  principal_due numeric(14, 2) not null check (principal_due >= 0),
  interest_due numeric(14, 2) not null check (interest_due >= 0),
  constraint loan_installments_unique unique (loan_id, schedule_version, installment_no)
);
create index loan_installments_due_idx on public.loan_installments (due_date);

create table public.loan_repayments (
  id uuid primary key default gen_random_uuid(),
  loan_id uuid not null references public.loans (id) on delete restrict,
  branch_id uuid not null references public.branches (id),
  finance_transaction_id uuid not null unique references public.finance_transactions (id),
  txn_no text not null,
  paid_on date not null,
  amount numeric(14, 2) not null check (amount > 0),
  principal numeric(14, 2) not null check (principal >= 0),
  interest numeric(14, 2) not null check (interest >= 0),
  schedule_version integer not null,
  posted_at timestamptz not null default now(),
  reversed_at timestamptz,
  reversal_reason text,
  constraint loan_repayments_split check (principal + interest = amount)
);
create index loan_repayments_loan_idx on public.loan_repayments (loan_id, schedule_version);
create index loan_repayments_paid_idx on public.loan_repayments (paid_on);

create table public.loan_restructures (
  id uuid primary key default gen_random_uuid(),
  loan_id uuid not null references public.loans (id) on delete restrict,
  branch_id uuid not null references public.branches (id),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  tenor_months integer not null check (tenor_months between 1 and 120),
  repayment_frequency text not null check (repayment_frequency in ('weekly', 'monthly', 'quarterly', 'end_of_term')),
  interest_rate numeric(7, 4) not null check (interest_rate >= 0 and interest_rate <= 100),
  rate_basis text not null check (rate_basis in ('per_month', 'per_annum')),
  interest_method text not null check (interest_method in ('flat', 'reducing_balance')),
  first_repayment_date date not null,
  reason text not null check (length(trim(reason)) > 0),
  requested_by uuid not null references public.staff (id),
  requested_at timestamptz not null default now(),
  decided_by uuid references public.staff (id),
  decided_at timestamptz,
  decision_note text,
  -- Filled in on approval.
  outstanding_principal numeric(14, 2),
  carried_interest numeric(14, 2),
  from_version integer,
  to_version integer
);
create unique index loan_restructures_one_pending_idx on public.loan_restructures (loan_id) where status = 'pending';

create table public.loan_reminders (
  id uuid primary key default gen_random_uuid(),
  loan_id uuid not null references public.loans (id) on delete restrict,
  branch_id uuid not null references public.branches (id),
  kind text not null check (kind in ('upcoming', 'overdue')),
  channel text not null check (channel in ('sms', 'call', 'whatsapp', 'email', 'visit')),
  due_date date,
  amount numeric(14, 2),
  note text,
  sent_by uuid not null default auth.uid() references public.staff (id),
  sent_at timestamptz not null default now()
);
create index loan_reminders_loan_idx on public.loan_reminders (loan_id, sent_at desc);

create or replace function app.loan_reminders_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_loan public.loans;
begin
  select * into v_loan from public.loans where id = new.loan_id;
  if v_loan.status <> 'active' then
    raise exception 'reminders are for active loans' using errcode = 'check_violation';
  end if;
  new.branch_id := v_loan.branch_id;
  new.sent_by := auth.uid();
  new.sent_at := now();
  return new;
end;
$$;

create trigger loan_reminders_guard
  before insert on public.loan_reminders
  for each row execute function app.loan_reminders_guard();

-- Writes a schedule version for a loan and returns its maturity date. Interest carried over from a restructure is
-- added to the first new instalment.
create or replace function app.write_loan_schedule(
  p_loan public.loans, p_version integer, p_principal numeric, p_start date, p_first_due date, p_carried_interest numeric
)
returns date
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_maturity date;
begin
  insert into public.loan_installments (loan_id, branch_id, schedule_version, installment_no, due_date, principal_due, interest_due)
  select p_loan.id, p_loan.branch_id, p_version, s.installment_no, s.due_date, s.principal_due,
         s.interest_due + case when s.installment_no = 1 then coalesce(p_carried_interest, 0) else 0 end
  from public.loan_schedule(p_principal, p_loan.interest_rate, p_loan.rate_basis, p_loan.interest_method,
                            p_loan.repayment_frequency, p_loan.tenor_months, p_start, p_first_due) s;
  select max(due_date) into v_maturity from public.loan_installments where loan_id = p_loan.id and schedule_version = p_version;
  return v_maturity;
end;
$$;
revoke all on function app.write_loan_schedule(public.loans, integer, numeric, date, date, numeric) from public, anon, authenticated;

-- Splits a payment between interest and principal: oldest instalment first, interest before principal within each.
-- p_paid_* are what the current schedule has already received. Raises if the payment is more than what is owed.
create or replace function app.loan_allocate(p_loan_id uuid, p_amount numeric, p_paid_principal numeric, p_paid_interest numeric)
returns table (principal numeric, interest numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_inst record;
  v_paid_p numeric := coalesce(p_paid_principal, 0);
  v_paid_i numeric := coalesce(p_paid_interest, 0);
  v_left numeric := p_amount;
  v_owed numeric := 0;
  v_take numeric;
  v_rem numeric;
begin
  principal := 0;
  interest := 0;
  for v_inst in
    select i.principal_due, i.interest_due
    from public.loan_installments i
    join public.loans l on l.id = i.loan_id and l.schedule_version = i.schedule_version
    where i.loan_id = p_loan_id
    order by i.installment_no
  loop
    v_take := least(v_inst.interest_due, v_paid_i);
    v_paid_i := v_paid_i - v_take;
    v_rem := v_inst.interest_due - v_take;
    v_owed := v_owed + v_rem;
    v_take := least(v_left, v_rem);
    v_left := v_left - v_take;
    interest := interest + v_take;

    v_take := least(v_inst.principal_due, v_paid_p);
    v_paid_p := v_paid_p - v_take;
    v_rem := v_inst.principal_due - v_take;
    v_owed := v_owed + v_rem;
    v_take := least(v_left, v_rem);
    v_left := v_left - v_take;
    principal := principal + v_take;
  end loop;
  if v_left > 0 then
    raise exception 'that is more than the ₦% still owed on this loan', to_char(v_owed, 'FM999,999,999,990.00')
      using errcode = 'check_violation';
  end if;
  return next;
end;
$$;
revoke all on function app.loan_allocate(uuid, numeric, numeric, numeric) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Positions: what each instalment and each loan has received, owes and is overdue
-- ---------------------------------------------------------------------------

-- Each instalment of the current schedule with what has been paid against it. Payments fill instalments in order,
-- which gives the same result as the allocation above.
create view public.loan_schedule_status with (security_invoker = true) as
with inst as (
  select i.*
  from public.loan_installments i
  join public.loans l on l.id = i.loan_id and l.schedule_version = i.schedule_version
),
paid as (
  select r.loan_id, r.schedule_version, sum(r.principal) as principal, sum(r.interest) as interest
  from public.loan_repayments r
  where r.reversed_at is null
  group by r.loan_id, r.schedule_version
),
filled as (
  select inst.*,
    greatest(0, least(inst.principal_due,
      coalesce(paid.principal, 0) - (sum(inst.principal_due) over w - inst.principal_due)))::numeric(14, 2) as principal_paid,
    greatest(0, least(inst.interest_due,
      coalesce(paid.interest, 0) - (sum(inst.interest_due) over w - inst.interest_due)))::numeric(14, 2) as interest_paid
  from inst
  left join paid on paid.loan_id = inst.loan_id and paid.schedule_version = inst.schedule_version
  window w as (partition by inst.loan_id order by inst.installment_no rows between unbounded preceding and current row)
)
select f.id, f.loan_id, f.branch_id, f.schedule_version, f.installment_no, f.due_date, f.principal_due, f.interest_due,
       f.principal_paid, f.interest_paid,
       (f.principal_due + f.interest_due - f.principal_paid - f.interest_paid)::numeric(14, 2) as outstanding,
       case
         when f.principal_paid + f.interest_paid >= f.principal_due + f.interest_due then 'paid'
         when f.due_date < current_date then 'overdue'
         when f.principal_paid + f.interest_paid > 0 then 'part_paid'
         else 'due'
       end as status
from filled f;
grant select on public.loan_schedule_status to authenticated;

-- One row per loan: the application, who is responsible, and its repayment position today.
create view public.loan_book with (security_invoker = true) as
select l.id, l.loan_no, l.branch_id, b.region_id, l.member_id,
       concat_ws(' ', m.first_name, m.middle_name, m.last_name) as member_name, m.membership_no,
       l.product_code, p.name as product_name, l.customer_category, l.account_officer_id, l.status,
       l.amount_requested, l.approved_amount, l.tenor_months, l.repayment_frequency, l.interest_rate, l.rate_basis,
       l.interest_method, l.risk_rating, l.created_at, l.submitted_at, l.appraised_at, l.approved_at, l.decided_at,
       l.disbursement_status, l.disbursed_on, l.maturity_date, l.closed_on,
       coalesce(s.principal_due, 0)::numeric(16, 2) as schedule_principal,
       coalesce(s.interest_due, 0)::numeric(16, 2) as schedule_interest,
       coalesce(r.principal, 0)::numeric(16, 2) as principal_repaid,
       coalesce(r.interest, 0)::numeric(16, 2) as interest_repaid,
       (coalesce(s.principal_due, 0) - coalesce(s.principal_paid, 0))::numeric(16, 2) as outstanding_principal,
       (coalesce(s.interest_due, 0) - coalesce(s.interest_paid, 0))::numeric(16, 2) as outstanding_interest,
       (coalesce(r.principal, 0) + coalesce(r.interest, 0) + coalesce(s.principal_due, 0) + coalesce(s.interest_due, 0)
         - coalesce(s.principal_paid, 0) - coalesce(s.interest_paid, 0))::numeric(16, 2) as total_expected,
       coalesce(s.overdue_amount, 0)::numeric(16, 2) as overdue_amount,
       coalesce(s.overdue_principal, 0)::numeric(16, 2) as overdue_principal,
       coalesce(s.missed, 0)::integer as missed_repayments,
       case when s.oldest_overdue is not null then current_date - s.oldest_overdue else 0 end as days_past_due,
       s.next_due_date, coalesce(s.next_due_amount, 0)::numeric(16, 2) as next_due_amount,
       coalesce(s.remaining, 0)::integer as remaining_installments,
       r.last_paid_on
from public.loans l
join public.branches b on b.id = l.branch_id
join public.members m on m.id = l.member_id
join public.loan_products p on p.code = l.product_code
left join lateral (
  select sum(x.principal_due) as principal_due, sum(x.interest_due) as interest_due,
         sum(x.principal_paid) as principal_paid, sum(x.interest_paid) as interest_paid,
         sum(x.outstanding) filter (where x.due_date < current_date) as overdue_amount,
         sum(x.principal_due - x.principal_paid) filter (where x.due_date < current_date) as overdue_principal,
         count(*) filter (where x.due_date < current_date and x.outstanding > 0) as missed,
         min(x.due_date) filter (where x.due_date < current_date and x.outstanding > 0) as oldest_overdue,
         min(x.due_date) filter (where x.due_date >= current_date and x.outstanding > 0) as next_due_date,
         (array_agg(x.outstanding order by x.installment_no) filter (where x.due_date >= current_date and x.outstanding > 0))[1]
           as next_due_amount,
         count(*) filter (where x.outstanding > 0) as remaining
  from public.loan_schedule_status x
  where x.loan_id = l.id
) s on true
left join lateral (
  select sum(rp.principal) as principal, sum(rp.interest) as interest, max(rp.paid_on) as last_paid_on
  from public.loan_repayments rp
  where rp.loan_id = l.id and rp.reversed_at is null
) r on true;
grant select on public.loan_book to authenticated;

-- Approved loans Accounts hasn't started paying out yet (a rejected or reversed payment puts the loan back here).
create view public.loans_awaiting_disbursement with (security_invoker = true) as
select l.id, l.loan_no, l.branch_id, l.member_id, concat_ws(' ', m.first_name, m.middle_name, m.last_name) as member_name,
       m.membership_no, l.product_code, p.name as product_name, l.approved_amount, l.approved_at, l.disbursement_status,
       l.disbursement_txn_no
from public.loans l
join public.members m on m.id = l.member_id
join public.loan_products p on p.code = l.product_code
where l.status = 'approved' and (l.disbursement_status is null or l.disbursement_status in ('rejected', 'reversed'));
grant select on public.loans_awaiting_disbursement to authenticated;

-- ---------------------------------------------------------------------------
-- Application workflow
-- ---------------------------------------------------------------------------

create or replace function public.submit_loan(p_loan_id uuid)
returns public.loans
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_loan public.loans;
  v_product public.loan_products;
begin
  select * into v_loan from public.loans where id = p_loan_id for update;
  if not found or not app.has_branch_permission('credit.manage', v_loan.branch_id) then
    raise exception 'loan not found' using errcode = 'no_data_found';
  end if;
  if v_loan.status not in ('draft', 'returned') then
    raise exception 'only draft or returned applications can be submitted' using errcode = 'check_violation';
  end if;
  select * into v_product from public.loan_products where code = v_loan.product_code;
  if not exists (select 1 from public.loan_documents d where d.loan_id = p_loan_id and d.document_type <> 'credit_bureau_report') then
    raise exception 'upload the signed application form or other supporting documents first' using errcode = 'check_violation';
  end if;
  if v_product.requires_proforma
     and not exists (select 1 from public.loan_documents d where d.loan_id = p_loan_id and d.document_type = 'proforma_invoice') then
    raise exception '% needs the proforma invoice uploaded', v_product.name using errcode = 'check_violation';
  end if;
  if v_product.requires_guarantor and not exists (select 1 from public.loan_guarantors g where g.loan_id = p_loan_id) then
    raise exception 'add at least one guarantor' using errcode = 'check_violation';
  end if;
  if v_product.requires_collateral and not exists (select 1 from public.loan_collaterals c where c.loan_id = p_loan_id) then
    raise exception '% needs collateral recorded', v_product.name using errcode = 'check_violation';
  end if;

  perform app.begin_workflow();
  update public.loans
     set status = 'submitted', submitted_by = auth.uid(), submitted_at = now(), decision_reason = null,
         bureau_check = null, bureau_name = null, bureau_score = null, risk_rating = null, recommendation = null,
         recommended_amount = null, appraisal_notes = null, appraised_by = null, appraised_at = null
   where id = p_loan_id
   returning * into v_loan;
  perform app.end_workflow();
  return v_loan;
end;
$$;

create or replace function public.appraise_loan(
  p_loan_id uuid, p_bureau_check text, p_bureau_name text, p_bureau_score text, p_risk_rating text,
  p_recommendation text, p_recommended_amount numeric, p_notes text
)
returns public.loans
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_loan public.loans;
begin
  select * into v_loan from public.loans where id = p_loan_id for update;
  if not found or not app.has_branch_permission('credit.appraise', v_loan.branch_id) then
    raise exception 'loan not found' using errcode = 'no_data_found';
  end if;
  if v_loan.status <> 'submitted' then
    raise exception 'only submitted applications can be appraised' using errcode = 'check_violation';
  end if;
  if auth.uid() in (v_loan.created_by, v_loan.submitted_by, v_loan.account_officer_id) then
    raise exception 'you prepared this application, so someone else must appraise it' using errcode = 'insufficient_privilege';
  end if;
  if p_bureau_check is null or p_bureau_check not in ('clear', 'adverse', 'no_record', 'not_checked') then
    raise exception 'record the credit bureau result' using errcode = 'check_violation';
  end if;
  if p_risk_rating is null or p_risk_rating not in ('low', 'medium', 'high') then
    raise exception 'choose a risk rating' using errcode = 'check_violation';
  end if;
  if p_recommendation is null or p_recommendation not in ('approve', 'decline') then
    raise exception 'say whether you recommend approval' using errcode = 'check_violation';
  end if;
  if p_recommendation = 'approve' and (p_recommended_amount is null or p_recommended_amount <= 0 or p_recommended_amount > v_loan.amount_requested) then
    raise exception 'the recommended amount must be above zero and no more than the amount requested' using errcode = 'check_violation';
  end if;
  if p_notes is null or length(trim(p_notes)) < 5 then
    raise exception 'write up the appraisal: capacity to repay, character and security' using errcode = 'check_violation';
  end if;

  perform app.begin_workflow();
  update public.loans
     set status = 'appraised', bureau_check = p_bureau_check, bureau_name = nullif(trim(p_bureau_name), ''),
         bureau_score = nullif(trim(p_bureau_score), ''), risk_rating = p_risk_rating, recommendation = p_recommendation,
         recommended_amount = case when p_recommendation = 'approve' then p_recommended_amount end,
         appraisal_notes = trim(p_notes), appraised_by = auth.uid(), appraised_at = now()
   where id = p_loan_id
   returning * into v_loan;
  perform app.end_workflow();
  return v_loan;
end;
$$;

-- Sends an application back to the account officer: by the analyst while appraising, or by management at decision.
create or replace function public.return_loan(p_loan_id uuid, p_reason text)
returns public.loans
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_loan public.loans;
begin
  select * into v_loan from public.loans where id = p_loan_id for update;
  if not found or not (app.has_branch_permission('credit.appraise', v_loan.branch_id) or app.has_branch_permission('credit.approve', v_loan.branch_id)) then
    raise exception 'loan not found' using errcode = 'no_data_found';
  end if;
  if v_loan.status = 'appraised' and not app.has_branch_permission('credit.approve', v_loan.branch_id) then
    raise exception 'this application is with management for a decision' using errcode = 'check_violation';
  end if;
  if v_loan.status not in ('submitted', 'appraised') then
    raise exception 'only applications being appraised or awaiting a decision can be returned' using errcode = 'check_violation';
  end if;
  if auth.uid() in (v_loan.created_by, v_loan.submitted_by) then
    raise exception 'you prepared this application, so someone else must review it' using errcode = 'insufficient_privilege';
  end if;
  if p_reason is null or length(trim(p_reason)) < 5 then
    raise exception 'say what needs correcting' using errcode = 'check_violation';
  end if;

  perform app.begin_workflow();
  update public.loans set status = 'returned', decision_reason = trim(p_reason) where id = p_loan_id returning * into v_loan;
  perform app.end_workflow();
  return v_loan;
end;
$$;

create or replace function public.decide_loan(p_loan_id uuid, p_approve boolean, p_approved_amount numeric, p_note text)
returns public.loans
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_loan public.loans;
begin
  select * into v_loan from public.loans where id = p_loan_id for update;
  if not found or not app.has_branch_permission('credit.approve', v_loan.branch_id) then
    raise exception 'loan not found' using errcode = 'no_data_found';
  end if;
  if v_loan.status <> 'appraised' then
    raise exception 'only appraised applications can be approved or rejected' using errcode = 'check_violation';
  end if;
  if auth.uid() in (v_loan.created_by, v_loan.submitted_by, v_loan.account_officer_id) then
    raise exception 'you prepared this application, so someone else must decide it' using errcode = 'insufficient_privilege';
  end if;
  if auth.uid() = v_loan.appraised_by then
    raise exception 'you appraised this application, so someone else must decide it' using errcode = 'insufficient_privilege';
  end if;

  perform app.begin_workflow();
  if p_approve then
    if p_approved_amount is null or p_approved_amount <= 0 or p_approved_amount > v_loan.amount_requested then
      raise exception 'the approved amount must be above zero and no more than the amount requested' using errcode = 'check_violation';
    end if;
    update public.loans
       set status = 'approved', approved_amount = p_approved_amount, approval_note = nullif(trim(p_note), ''),
           approved_by = auth.uid(), approved_at = now(), decided_by = auth.uid(), decided_at = now(), decision_reason = null
     where id = p_loan_id
     returning * into v_loan;
  else
    if p_note is null or length(trim(p_note)) < 5 then
      raise exception 'give the reason for rejecting the application' using errcode = 'check_violation';
    end if;
    update public.loans
       set status = 'rejected', decision_reason = trim(p_note), decided_by = auth.uid(), decided_at = now()
     where id = p_loan_id
     returning * into v_loan;
  end if;
  perform app.end_workflow();
  return v_loan;
end;
$$;

-- Withdraws an application (account officer, before it is submitted) or an approved loan that won't be taken up
-- (management, before Accounts starts paying it out).
create or replace function public.cancel_loan(p_loan_id uuid, p_reason text)
returns public.loans
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_loan public.loans;
begin
  select * into v_loan from public.loans where id = p_loan_id for update;
  if not found or not (app.has_branch_permission('credit.manage', v_loan.branch_id) or app.has_branch_permission('credit.approve', v_loan.branch_id)) then
    raise exception 'loan not found' using errcode = 'no_data_found';
  end if;
  if v_loan.status in ('draft', 'returned') then
    if not app.has_branch_permission('credit.manage', v_loan.branch_id) then
      raise exception 'the account officer withdraws a draft application' using errcode = 'insufficient_privilege';
    end if;
  elsif v_loan.status = 'approved' then
    if not app.has_branch_permission('credit.approve', v_loan.branch_id) then
      raise exception 'only management can cancel an approved loan' using errcode = 'insufficient_privilege';
    end if;
    if v_loan.disbursement_status is not null and v_loan.disbursement_status not in ('rejected', 'reversed') then
      raise exception 'Accounts is already paying this loan out (%); they must reject the payment first', v_loan.disbursement_txn_no
        using errcode = 'check_violation';
    end if;
  else
    raise exception 'a % loan can''t be cancelled', v_loan.status using errcode = 'check_violation';
  end if;
  if p_reason is null or length(trim(p_reason)) < 5 then
    raise exception 'say why the loan is being cancelled' using errcode = 'check_violation';
  end if;

  perform app.begin_workflow();
  update public.loans set status = 'cancelled', decision_reason = trim(p_reason), decided_by = auth.uid(), decided_at = now()
   where id = p_loan_id returning * into v_loan;
  perform app.end_workflow();
  return v_loan;
end;
$$;

-- Moves a loan to another account officer, for example when an officer leaves. Performance follows the loan.
create or replace function public.reassign_loan_officer(p_loan_id uuid, p_officer_id uuid)
returns public.loans
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_loan public.loans;
begin
  select * into v_loan from public.loans where id = p_loan_id for update;
  if not found or not app.has_branch_permission('credit.approve', v_loan.branch_id) then
    raise exception 'loan not found' using errcode = 'no_data_found';
  end if;
  if v_loan.status in ('closed', 'rejected', 'cancelled') then
    raise exception 'a % loan keeps its account officer', v_loan.status using errcode = 'check_violation';
  end if;
  if not app.staff_has_branch_permission(p_officer_id, 'credit.manage', v_loan.branch_id) then
    raise exception 'choose a Credit account officer for this branch' using errcode = 'check_violation';
  end if;
  perform app.begin_workflow();
  update public.loans set account_officer_id = p_officer_id where id = p_loan_id returning * into v_loan;
  perform app.end_workflow();
  return v_loan;
end;
$$;

-- ---------------------------------------------------------------------------
-- Restructuring
-- ---------------------------------------------------------------------------

create or replace function public.request_loan_restructure(
  p_loan_id uuid, p_tenor_months integer, p_frequency text, p_interest_rate numeric, p_rate_basis text,
  p_interest_method text, p_first_due date, p_reason text
)
returns public.loan_restructures
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_loan public.loans;
  v_row public.loan_restructures;
begin
  select * into v_loan from public.loans where id = p_loan_id for update;
  if not found or not app.has_branch_permission('credit.manage', v_loan.branch_id) then
    raise exception 'loan not found' using errcode = 'no_data_found';
  end if;
  if v_loan.status <> 'active' then
    raise exception 'only active loans can be restructured' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.loan_restructures r where r.loan_id = p_loan_id and r.status = 'pending') then
    raise exception 'a restructure for this loan is already waiting for approval' using errcode = 'check_violation';
  end if;
  if p_first_due is null or p_first_due <= current_date then
    raise exception 'the first new repayment date must be in the future' using errcode = 'check_violation';
  end if;
  if p_frequency = 'quarterly' and p_tenor_months % 3 <> 0 then
    raise exception 'a quarterly loan''s tenor must be a whole number of quarters' using errcode = 'check_violation';
  end if;
  if p_reason is null or length(trim(p_reason)) < 5 then
    raise exception 'say why the loan is being restructured' using errcode = 'check_violation';
  end if;

  insert into public.loan_restructures
    (loan_id, branch_id, tenor_months, repayment_frequency, interest_rate, rate_basis, interest_method, first_repayment_date,
     reason, requested_by)
  values
    (p_loan_id, v_loan.branch_id, p_tenor_months, p_frequency, p_interest_rate, p_rate_basis, p_interest_method, p_first_due,
     trim(p_reason), auth.uid())
  returning * into v_row;
  return v_row;
end;
$$;

-- On approval, the principal still owed (plus interest already due and unpaid) gets a new schedule on the new terms.
-- Interest the old schedule had not yet charged is replaced by the new schedule's interest.
create or replace function public.decide_loan_restructure(p_id uuid, p_approve boolean, p_note text)
returns public.loan_restructures
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.loan_restructures;
  v_loan public.loans;
  v_principal numeric;
  v_carried numeric;
  v_maturity date;
begin
  select * into v_row from public.loan_restructures where id = p_id for update;
  if not found or not app.has_branch_permission('credit.approve', v_row.branch_id) then
    raise exception 'restructure not found' using errcode = 'no_data_found';
  end if;
  if v_row.status <> 'pending' then
    raise exception 'this restructure has already been decided' using errcode = 'check_violation';
  end if;
  if auth.uid() = v_row.requested_by then
    raise exception 'you requested this restructure, so someone else must decide it' using errcode = 'insufficient_privilege';
  end if;
  select * into v_loan from public.loans where id = v_row.loan_id for update;

  if not p_approve then
    if p_note is null or length(trim(p_note)) < 5 then
      raise exception 'give the reason for declining the restructure' using errcode = 'check_violation';
    end if;
    update public.loan_restructures set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_note = trim(p_note)
     where id = p_id returning * into v_row;
    return v_row;
  end if;

  if v_loan.status <> 'active' then
    raise exception 'the loan is no longer active' using errcode = 'check_violation';
  end if;
  if exists (
    select 1 from public.finance_transactions t
    where t.loan_id = v_loan.id and t.transaction_type = 'loan_repayment' and t.status in ('draft', 'submitted', 'returned', 'approved')
  ) then
    raise exception 'a repayment for this loan is still being processed in Accounts; post or reject it first' using errcode = 'check_violation';
  end if;

  select coalesce(sum(s.principal_due - s.principal_paid), 0),
         coalesce(sum(s.interest_due - s.interest_paid) filter (where s.due_date <= current_date), 0)
    into v_principal, v_carried
  from public.loan_schedule_status s where s.loan_id = v_loan.id;
  if v_principal <= 0 then
    raise exception 'there is no principal left to restructure' using errcode = 'check_violation';
  end if;

  perform app.begin_workflow();
  update public.loans
     set tenor_months = v_row.tenor_months, repayment_frequency = v_row.repayment_frequency, interest_rate = v_row.interest_rate,
         rate_basis = v_row.rate_basis, interest_method = v_row.interest_method, first_repayment_date = v_row.first_repayment_date,
         schedule_version = v_loan.schedule_version + 1
   where id = v_loan.id
   returning * into v_loan;
  v_maturity := app.write_loan_schedule(v_loan, v_loan.schedule_version, v_principal, current_date, v_row.first_repayment_date, v_carried);
  update public.loans set maturity_date = v_maturity where id = v_loan.id;
  update public.loan_restructures
     set status = 'approved', decided_by = auth.uid(), decided_at = now(), decision_note = nullif(trim(p_note), ''),
         outstanding_principal = v_principal, carried_interest = v_carried,
         from_version = v_loan.schedule_version - 1, to_version = v_loan.schedule_version
   where id = p_id
   returning * into v_row;
  perform app.end_workflow();
  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- Accounts: disbursements and repayments are receipts and payments linked to a loan
-- ---------------------------------------------------------------------------

alter table public.finance_transactions
  add column loan_id uuid references public.loans (id),
  add column loan_schedule_version integer;
create index finance_transactions_loan_idx on public.finance_transactions (loan_id) where loan_id is not null;

-- A repayment can be all interest (for example, paying only the interest due), so interest may equal the amount.
alter table public.finance_transactions drop constraint finance_transactions_interest;
alter table public.finance_transactions add constraint finance_transactions_interest check (interest_amount <= amount);

-- Runs after finance_transactions_guard and finance_transactions_guard_dimensions (alphabetical order).
create or replace function app.finance_transactions_loans()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_loan public.loans;
  v_paid_p numeric;
  v_paid_i numeric;
  v_split record;
begin
  if tg_op = 'UPDATE' and app.in_workflow() then
    return new;
  end if;

  if new.transaction_type in ('loan_disbursement', 'loan_repayment') and new.loan_id is null then
    raise exception 'choose the loan this % is for', case when new.direction = 'receipt' then 'repayment' else 'disbursement' end
      using errcode = 'check_violation';
  end if;
  if new.loan_id is null then
    new.loan_schedule_version := null;
    return new;
  end if;
  if new.transaction_type not in ('loan_disbursement', 'loan_repayment') then
    raise exception 'only loan disbursements and repayments are linked to a loan' using errcode = 'check_violation';
  end if;
  if tg_op = 'UPDATE' and new.loan_id is distinct from old.loan_id and old.transaction_type = 'loan_disbursement' then
    raise exception 'a disbursement stays with its loan; reject it and raise a new one' using errcode = 'check_violation';
  end if;

  select * into v_loan from public.loans where id = new.loan_id;
  if v_loan.branch_id <> new.branch_id then
    raise exception 'use a bank or cash account of the loan''s branch' using errcode = 'check_violation';
  end if;
  new.member_id := v_loan.member_id;
  new.loan_schedule_version := v_loan.schedule_version;

  if new.transaction_type = 'loan_disbursement' then
    if v_loan.status <> 'approved' then
      raise exception 'only approved loans can be paid out' using errcode = 'check_violation';
    end if;
    if new.amount <> v_loan.approved_amount then
      raise exception 'the disbursement must be the approved amount of ₦%', to_char(v_loan.approved_amount, 'FM999,999,999,990.00')
        using errcode = 'check_violation';
    end if;
    if exists (
      select 1 from public.finance_transactions t
      where t.loan_id = new.loan_id and t.transaction_type = 'loan_disbursement' and t.id <> new.id
        and t.status not in ('rejected', 'reversed')
    ) then
      raise exception 'this loan already has a disbursement in Accounts' using errcode = 'check_violation';
    end if;
    new.interest_amount := 0;
    return new;
  end if;

  -- Repayment: the database works out how much is interest, after any earlier repayments still being processed.
  if v_loan.status <> 'active' then
    raise exception 'repayments are recorded against active loans' using errcode = 'check_violation';
  end if;
  select coalesce(sum(r.principal), 0), coalesce(sum(r.interest), 0) into v_paid_p, v_paid_i
  from public.loan_repayments r
  where r.loan_id = v_loan.id and r.schedule_version = v_loan.schedule_version and r.reversed_at is null;
  select v_paid_p + coalesce(sum(t.amount - t.interest_amount), 0), v_paid_i + coalesce(sum(t.interest_amount), 0)
    into v_paid_p, v_paid_i
  from public.finance_transactions t
  where t.loan_id = v_loan.id and t.transaction_type = 'loan_repayment' and t.id <> new.id
    and t.status in ('draft', 'submitted', 'returned', 'approved')
    and t.created_at < coalesce(new.created_at, now());
  select * into v_split from app.loan_allocate(v_loan.id, new.amount, v_paid_p, v_paid_i);
  new.interest_amount := v_split.interest;
  return new;
end;
$$;

create trigger finance_transactions_guard_loans
  before insert or update on public.finance_transactions
  for each row execute function app.finance_transactions_loans();

-- Keeps the loan in step with its money in Accounts: activates it when the disbursement posts, records each posted
-- repayment, closes it when nothing is owed, and undoes these when Accounts reverses the journal.
create or replace function app.finance_transactions_loan_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_loan public.loans;
  v_was_on boolean := app.in_workflow();
  v_paid_p numeric;
  v_paid_i numeric;
  v_split record;
  v_maturity date;
  v_left numeric;
  v_repayment public.loan_repayments;
begin
  if new.loan_id is null or (tg_op = 'UPDATE' and new.status is not distinct from old.status) then
    return null;
  end if;
  select * into v_loan from public.loans where id = new.loan_id for update;
  perform app.begin_workflow();

  if new.transaction_type = 'loan_disbursement' then
    update public.loans set disbursement_txn_id = new.id, disbursement_txn_no = new.txn_no, disbursement_status = new.status::text
     where id = v_loan.id;
    if new.status = 'posted' then
      update public.loans set status = 'active', disbursed_on = new.txn_date, schedule_version = 1 where id = v_loan.id
      returning * into v_loan;
      v_maturity := app.write_loan_schedule(v_loan, 1, v_loan.approved_amount, new.txn_date, v_loan.first_repayment_date, 0);
      update public.loans set maturity_date = v_maturity where id = v_loan.id;
    elsif new.status = 'reversed' then
      if exists (select 1 from public.loan_repayments r where r.loan_id = v_loan.id and r.reversed_at is null) then
        raise exception 'this loan has repayments; reverse those first' using errcode = 'check_violation';
      end if;
      delete from public.loan_installments where loan_id = v_loan.id;
      update public.loans set status = 'approved', disbursed_on = null, schedule_version = 0, maturity_date = null where id = v_loan.id;
    end if;
  elsif new.status = 'posted' then
    if new.loan_schedule_version is distinct from v_loan.schedule_version or v_loan.status <> 'active' then
      raise exception 'the loan has changed since this repayment was prepared; return it so it can be saved again' using errcode = 'check_violation';
    end if;
    select coalesce(sum(r.principal), 0), coalesce(sum(r.interest), 0) into v_paid_p, v_paid_i
    from public.loan_repayments r
    where r.loan_id = v_loan.id and r.schedule_version = v_loan.schedule_version and r.reversed_at is null;
    select * into v_split from app.loan_allocate(v_loan.id, new.amount, v_paid_p, v_paid_i);
    if v_split.interest <> new.interest_amount then
      raise exception 'other repayments on this loan were posted first, so this one''s interest split has changed; return it so it can be saved again'
        using errcode = 'check_violation';
    end if;
    insert into public.loan_repayments (loan_id, branch_id, finance_transaction_id, txn_no, paid_on, amount, principal, interest, schedule_version)
    values (v_loan.id, v_loan.branch_id, new.id, new.txn_no, new.txn_date, new.amount, new.amount - new.interest_amount,
            new.interest_amount, v_loan.schedule_version);
    select coalesce(sum(s.outstanding), 0) into v_left from public.loan_schedule_status s where s.loan_id = v_loan.id;
    if v_left = 0 then
      update public.loans set status = 'closed', closed_on = new.txn_date where id = v_loan.id;
    end if;
  elsif new.status = 'reversed' then
    select * into v_repayment from public.loan_repayments where finance_transaction_id = new.id;
    if v_repayment.schedule_version <> v_loan.schedule_version then
      raise exception 'this repayment was made before the loan was restructured, so it can''t be reversed here; ask Credit' using errcode = 'check_violation';
    end if;
    update public.loan_repayments set reversed_at = now(), reversal_reason = new.decision_reason where id = v_repayment.id;
    if v_loan.status = 'closed' then
      update public.loans set status = 'active', closed_on = null where id = v_loan.id;
    end if;
  end if;

  if not v_was_on then
    perform app.end_workflow();
  end if;
  return null;
end;
$$;

create trigger finance_transactions_loan_events
  after insert or update on public.finance_transactions
  for each row execute function app.finance_transactions_loan_events();

-- A disbursement raised from an approved loan uses the loan file as its evidence; everything else is unchanged.
create or replace function public.submit_finance_transaction(p_id uuid)
returns public.finance_transactions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_txn public.finance_transactions;
begin
  select * into v_txn from public.finance_transactions where id = p_id for update;
  if not found or not app.has_branch_permission(
    case when v_txn.direction = 'receipt' then 'accounts.receipts.record' else 'accounts.payments.request' end, v_txn.branch_id
  ) then
    raise exception 'transaction not found' using errcode = 'no_data_found';
  end if;
  if v_txn.status not in ('draft', 'returned') then
    raise exception 'only draft or returned transactions can be submitted' using errcode = 'check_violation';
  end if;
  if v_txn.contribution_id is null and v_txn.statement_line_id is null
     and not (v_txn.transaction_type = 'loan_disbursement' and v_txn.loan_id is not null)
     and not exists (select 1 from public.finance_attachments a where a.transaction_id = p_id and a.kind = 'supporting') then
    raise exception 'attach the supporting evidence (receipt, invoice or approval) before submitting' using errcode = 'check_violation';
  end if;

  perform app.begin_workflow();
  update public.finance_transactions
     set status = 'submitted', submitted_by = auth.uid(), submitted_at = now(), decision_reason = null
   where id = p_id
   returning * into v_txn;
  perform app.end_workflow();
  return v_txn;
end;
$$;

-- Unchanged, except that a repayment that is all interest has no principal line.
create or replace function app.post_finance_transaction(p_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_txn public.finance_transactions;
  v_rule public.posting_rules;
  v_bank public.bank_accounts;
  v_entry_id uuid;
  v_bank_line_id uuid;
  v_match_id uuid;
  v_description text;
begin
  select * into v_txn from public.finance_transactions where id = p_id;
  select * into v_rule from public.posting_rules where transaction_type = v_txn.transaction_type;
  select * into v_bank from public.bank_accounts where id = v_txn.bank_account_id;
  v_description := v_txn.txn_no || ' ' || v_rule.name || coalesce(' - ' || v_txn.counterparty, '');

  perform app.begin_workflow();
  insert into public.journal_entries (branch_id, entry_date, description, source, transaction_id, status, created_by, posted_by, posted_at)
  values (v_txn.branch_id, v_txn.txn_date, v_description, 'transaction', v_txn.id, 'draft', v_txn.created_by, auth.uid(), now())
  returning id into v_entry_id;

  if v_txn.direction = 'receipt' then
    insert into public.journal_lines (entry_id, line_no, account_code, debit, member_id, bank_account_id, description)
    values (v_entry_id, 1, v_bank.ledger_account_code, v_txn.amount, v_txn.member_id, v_bank.id, v_txn.description)
    returning id into v_bank_line_id;
    if v_txn.amount - v_txn.interest_amount > 0 then
      insert into public.journal_lines (entry_id, line_no, account_code, credit, member_id, description)
      values (v_entry_id, 2, v_rule.credit_account, v_txn.amount - v_txn.interest_amount, v_txn.member_id, v_txn.description);
    end if;
    if v_txn.interest_amount > 0 then
      insert into public.journal_lines (entry_id, line_no, account_code, credit, member_id, description)
      values (v_entry_id, 3, v_rule.interest_account, v_txn.interest_amount, v_txn.member_id, 'Interest');
    end if;
  else
    insert into public.journal_lines (entry_id, line_no, account_code, debit, member_id, description)
    values (v_entry_id, 1, v_rule.debit_account, v_txn.amount, v_txn.member_id, v_txn.description);
    insert into public.journal_lines (entry_id, line_no, account_code, credit, member_id, bank_account_id, description)
    values (v_entry_id, 2, v_bank.ledger_account_code, v_txn.amount, v_txn.member_id, v_bank.id, v_txn.description)
    returning id into v_bank_line_id;
  end if;

  perform app.assert_balanced(v_entry_id);
  update public.journal_entries set status = 'posted' where id = v_entry_id;

  -- Only real bank accounts are reconciled against statements.
  if v_txn.statement_line_id is not null and v_bank.kind = 'bank' then
    insert into public.bank_matches (bank_account_id, branch_id, method, note)
    values (v_bank.id, v_bank.branch_id, 'posted', 'Posted from the statement line')
    returning id into v_match_id;
    insert into public.bank_match_ledger_lines (match_id, journal_line_id) values (v_match_id, v_bank_line_id);
    update public.bank_statement_lines set status = 'matched', match_id = v_match_id where id = v_txn.statement_line_id;
  end if;

  update public.finance_transactions
     set status = 'posted', posted_at = now(), journal_entry_id = v_entry_id
   where id = p_id;
  perform app.end_workflow();
  return v_entry_id;
end;
$$;
revoke all on function app.post_finance_transaction(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Internal Audit: overdue loans and credit control breaches join the exceptions; loans join the branch reports
-- ---------------------------------------------------------------------------

create or replace function public.audit_exceptions(p_large_amount numeric default 1000000)
returns table (
  category text, severity text, branch_id uuid, record_type text, record_id uuid, summary text, detail text, occurred_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  -- Member files missing required KYC documents (drafts get two weeks before they count).
  select 'incomplete_kyc', case when m.status = 'approved' then 'high' else 'medium' end, m.branch_id, 'member', m.id,
         concat_ws(' ', m.first_name, m.last_name) || ' is missing KYC documents',
         'Status ' || m.status || '. Missing: ' || array_to_string(x.missing, ', '),
         coalesce(m.submitted_at, m.created_at)
  from public.members m
  cross join lateral (
    select array_agg(t::text order by t) as missing
    from unnest(array['kyc_form', 'nin_slip', 'means_of_id', 'utility_bill']::public.member_document_type[]) as t
    where not exists (select 1 from public.member_documents d where d.member_id = m.id and d.document_type = t)
  ) x
  where x.missing is not null and (m.status <> 'draft' or m.created_at < now() - interval '14 days')

  union all
  -- Files waiting on the Branch Manager for more than a week.
  select 'stale_approval', 'medium', m.branch_id, 'member', m.id,
         concat_ws(' ', m.first_name, m.last_name) || ' has waited over 7 days for approval',
         'Submitted ' || to_char(m.submitted_at, 'DD Mon YYYY'), m.submitted_at
  from public.members m
  where m.status = 'pending_approval' and m.submitted_at < now() - interval '7 days'

  union all
  -- Payments recorded but not verified within three days.
  select 'unverified_payment', 'medium', c.branch_id, 'contribution', c.id,
         'Contribution of ₦' || to_char(c.amount, 'FM999,999,999,990.00') || ' not verified',
         'Recorded ' || to_char(c.recorded_at, 'DD Mon YYYY') || coalesce(', reference ' || c.reference, ''), c.recorded_at
  from public.contributions c
  where c.verified_at is null and c.recorded_at < now() - interval '3 days'

  union all
  -- Adjustments: contribution reversals in the last 90 days.
  select 'adjustment', 'medium', c.branch_id, 'contribution', c.id,
         'Contribution reversed (₦' || to_char(abs(c.amount), 'FM999,999,999,990.00') || ')',
         'Reason: ' || coalesce(c.notes, '—'), c.recorded_at
  from public.contributions c
  where c.kind = 'reversal' and c.recorded_at > now() - interval '90 days'

  union all
  -- Adjustments: reversed journal entries in the last 90 days.
  select 'adjustment', 'medium', e.branch_id, 'journal_entry', e.id,
         'Journal ' || o.entry_no || ' reversed by ' || e.entry_no,
         'Reason: ' || coalesce(e.reversal_reason, '—'), e.posted_at
  from public.journal_entries e
  join public.journal_entries o on o.id = e.reverses_entry_id
  where e.posted_at > now() - interval '90 days'

  union all
  -- Adjustments: loans restructured in the last 90 days.
  select 'adjustment', 'medium', r.branch_id, 'loan', r.loan_id,
         'Loan ' || l.loan_no || ' restructured',
         'New terms: ' || r.tenor_months || ' months. Reason: ' || r.reason, r.decided_at
  from public.loan_restructures r
  join public.loans l on l.id = r.loan_id
  where r.status = 'approved' and r.decided_at > now() - interval '90 days'

  union all
  -- Changes to approved member records in the last 90 days.
  select 'approved_record_changed', 'medium', a.branch_id, 'member', a.record_id::uuid,
         'Approved member record changed: ' || concat_ws(' ', a.new_data ->> 'first_name', a.new_data ->> 'last_name'),
         'Fields: ' || array_to_string(array(select f from unnest(a.changed_fields) f where f not in ('updated_at', 'amendment_reason')), ', ')
           || '. Reason: ' || coalesce(a.new_data ->> 'amendment_reason', '—'),
         a.occurred_at
  from public.audit_log a
  where a.table_name = 'public.members' and a.action = 'UPDATE'
    and a.old_data ->> 'status' = 'approved' and a.new_data ->> 'status' = 'approved'
    and a.occurred_at > now() - interval '90 days'

  union all
  -- Unusually large amounts.
  select 'large_transaction', 'low', c.branch_id, 'contribution', c.id,
         'Large contribution of ₦' || to_char(abs(c.amount), 'FM999,999,999,990.00'),
         'Paid ' || to_char(c.paid_on, 'DD Mon YYYY') || coalesce(', reference ' || c.reference, ''), c.recorded_at
  from public.contributions c
  where abs(c.amount) >= p_large_amount
  union all
  select 'large_transaction', 'low', t.branch_id, 'finance_transaction', t.id,
         'Large ' || t.direction || ' ' || t.txn_no || ' of ₦' || to_char(t.amount, 'FM999,999,999,990.00'),
         t.description, t.created_at
  from public.finance_transactions t
  where t.amount >= p_large_amount and t.status not in ('draft', 'rejected')

  union all
  -- Segregation of duties breaches. The workflow functions prevent these, so any row here needs investigating.
  select 'segregation_breach', 'high', t.branch_id, 'finance_transaction', t.id,
         t.txn_no || ' was approved or paid by the person who prepared or approved it', t.description, t.approved_at
  from public.finance_transactions t
  where t.approved_by in (t.created_by, t.submitted_by) or t.paid_by = t.approved_by
  union all
  select 'segregation_breach', 'high', m.branch_id, 'member', m.id,
         concat_ws(' ', m.first_name, m.last_name) || ' was approved by the person who prepared the file', null, m.approved_at
  from public.members m
  where m.approved_by in (m.created_by, m.submitted_by)
  union all
  select 'segregation_breach', 'high', c.branch_id, 'contribution', c.id,
         'A contribution was verified by the person who recorded it', null, c.verified_at
  from public.contributions c
  where c.verified_by = c.recorded_by
  union all
  select 'segregation_breach', 'high', l.branch_id, 'loan', l.id,
         'Loan ' || l.loan_no || ' was appraised or approved by someone who prepared it, or approved by its appraiser', null,
         coalesce(l.approved_at, l.appraised_at)
  from public.loans l
  where l.appraised_by in (l.created_by, l.submitted_by, l.account_officer_id)
     or l.approved_by in (l.created_by, l.submitted_by, l.appraised_by)

  union all
  -- Overdue loans: anything past due. Over 90 days is high, over 30 days medium.
  select 'overdue_loan', case when lb.days_past_due > 90 then 'high' when lb.days_past_due > 30 then 'medium' else 'low' end,
         lb.branch_id, 'loan', lb.id,
         'Loan ' || lb.loan_no || ' (' || lb.member_name || ') is ' || lb.days_past_due || ' days overdue',
         '₦' || to_char(lb.overdue_amount, 'FM999,999,999,990.00') || ' overdue across ' || lb.missed_repayments
           || ' missed repayment(s); ₦' || to_char(lb.outstanding_principal, 'FM999,999,999,990.00') || ' principal outstanding',
         (current_date - lb.days_past_due)::timestamptz
  from public.loan_book lb
  where lb.status = 'active' and lb.days_past_due > 0

  union all
  -- Loan applications waiting more than a week for appraisal or a decision.
  select 'stale_loan_application', 'low', l.branch_id, 'loan', l.id,
         'Loan application ' || l.loan_no || ' has waited over 7 days for ' || case when l.status = 'submitted' then 'appraisal' else 'a decision' end,
         'Submitted ' || to_char(l.submitted_at, 'DD Mon YYYY'), l.submitted_at
  from public.loans l
  where l.status in ('submitted', 'appraised') and l.submitted_at < now() - interval '7 days'

  union all
  -- Approved loans not paid out within two weeks.
  select 'loan_not_disbursed', 'low', l.branch_id, 'loan', l.id,
         'Approved loan ' || l.loan_no || ' not disbursed after 14 days',
         'Approved ' || to_char(l.approved_at, 'DD Mon YYYY') || coalesce('. In Accounts as ' || l.disbursement_txn_no, ''), l.approved_at
  from public.loans l
  where l.status = 'approved' and l.approved_at < now() - interval '14 days'

  union all
  -- Bank lines nobody has explained after two weeks.
  select 'unmatched_bank_line', 'medium', s.branch_id, 'bank_statement_line', s.id,
         'Unmatched bank line of ₦' || to_char(s.amount, 'FM999,999,999,990.00'),
         to_char(s.line_date, 'DD Mon YYYY') || ': ' || s.description, s.line_date::timestamptz
  from public.bank_statement_lines s
  where s.status = 'unmatched' and s.line_date < current_date - 14

  union all
  -- Unidentified deposits still sitting in the holding account after two weeks.
  select 'unidentified_receipt', 'medium', t.branch_id, 'finance_transaction', t.id,
         'Unidentified deposit ' || t.txn_no || ' of ₦' || to_char(t.amount, 'FM999,999,999,990.00') || ' not cleared',
         t.description, t.posted_at
  from public.finance_transactions t
  where t.transaction_type = 'unidentified_receipt' and t.status = 'posted' and t.txn_date < current_date - 14

  union all
  -- Receipts and payment requests waiting more than three days for a decision.
  select 'stale_finance_approval', 'low', t.branch_id, 'finance_transaction', t.id,
         t.txn_no || ' has waited over 3 days for approval', t.description, t.submitted_at
  from public.finance_transactions t
  where t.status = 'submitted' and t.submitted_at < now() - interval '3 days'

  union all
  -- Posted journals that don't balance. The posting functions prevent this.
  select 'unbalanced_journal', 'high', e.branch_id, 'journal_entry', e.id,
         'Journal ' || e.entry_no || ' does not balance', e.description, e.posted_at
  from public.journal_entries e
  join public.journal_lines l on l.entry_id = e.id
  where e.status = 'posted'
  group by e.id
  having sum(l.debit) <> sum(l.credit)

  union all
  -- Deletions in the last 90 days (for example, KYC documents removed from a draft).
  select 'deletion', 'low', a.branch_id, replace(a.table_name, 'public.', ''), null,
         'Deleted from ' || replace(a.table_name, 'public.', ''),
         coalesce(a.old_data ->> 'file_name', a.old_data ->> 'full_name', a.old_data ->> 'name', a.record_id), a.occurred_at
  from public.audit_log a
  where a.action = 'DELETE' and a.occurred_at > now() - interval '90 days';
$$;

drop function public.branch_operations(date, date, text, uuid, uuid);

-- One row per branch and period: registrations, approvals, collections, posted cash movements and loans.
create or replace function public.branch_operations(
  p_from date, p_to date, p_grain text default 'month', p_branch_id uuid default null, p_region_id uuid default null
)
returns table (
  period_start date, branch_id uuid, branch_name text, region_name text,
  registrations bigint, approvals bigint, contributions_count bigint, contributions_total numeric, top_ups_total numeric,
  reversals_total numeric, unverified_count bigint, receipts_total numeric, payments_total numeric,
  loans_disbursed bigint, loans_disbursed_total numeric, loan_repayments_total numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  with events as (
    select m.branch_id, m.created_at::date as day, 'registration' as kind, 0::numeric as amount, false as unverified
    from public.members m where m.created_at::date between p_from and p_to
    union all
    select m.branch_id, m.approved_at::date, 'approval', 0, false
    from public.members m where m.approved_at::date between p_from and p_to
    union all
    select c.branch_id, c.paid_on, c.kind::text, c.amount, c.verified_at is null
    from public.contributions c where c.paid_on between p_from and p_to
    union all
    select t.branch_id, t.txn_date, t.direction, t.amount, false
    from public.finance_transactions t where t.status = 'posted' and t.txn_date between p_from and p_to
    union all
    select l.branch_id, l.disbursed_on, 'loan_disbursed', l.approved_amount, false
    from public.loans l where l.disbursed_on between p_from and p_to
    union all
    select r.branch_id, r.paid_on, 'loan_repayment', r.amount, false
    from public.loan_repayments r where r.reversed_at is null and r.paid_on between p_from and p_to
  )
  select date_trunc(case when p_grain in ('day', 'week', 'month') then p_grain else 'month' end, ev.day)::date,
         b.id, b.name, r.name,
         count(*) filter (where ev.kind = 'registration'),
         count(*) filter (where ev.kind = 'approval'),
         count(*) filter (where ev.kind in ('scheduled', 'top_up')),
         coalesce(sum(ev.amount) filter (where ev.kind in ('scheduled', 'top_up', 'reversal')), 0)::numeric(16, 2),
         coalesce(sum(ev.amount) filter (where ev.kind = 'top_up'), 0)::numeric(16, 2),
         coalesce(sum(ev.amount) filter (where ev.kind = 'reversal'), 0)::numeric(16, 2),
         count(*) filter (where ev.unverified),
         coalesce(sum(ev.amount) filter (where ev.kind = 'receipt'), 0)::numeric(16, 2),
         coalesce(sum(ev.amount) filter (where ev.kind = 'payment'), 0)::numeric(16, 2),
         count(*) filter (where ev.kind = 'loan_disbursed'),
         coalesce(sum(ev.amount) filter (where ev.kind = 'loan_disbursed'), 0)::numeric(16, 2),
         coalesce(sum(ev.amount) filter (where ev.kind = 'loan_repayment'), 0)::numeric(16, 2)
  from events ev
  join public.branches b on b.id = ev.branch_id
  join public.regions r on r.id = b.region_id
  where (p_branch_id is null or b.id = p_branch_id)
    and (p_region_id is null or b.region_id = p_region_id)
  group by 1, b.id, r.name
  order by 1, b.name;
$$;

create index audit_log_loan_idx on public.audit_log ((new_data ->> 'loan_id')) where new_data ? 'loan_id';

-- ---------------------------------------------------------------------------
-- Audit trail
-- ---------------------------------------------------------------------------

select app.enable_audit('public.loan_products');
select app.enable_audit('public.loans');
select app.enable_audit('public.loan_guarantors');
select app.enable_audit('public.loan_collaterals');
select app.enable_audit('public.loan_documents');
select app.enable_audit('public.loan_installments');
select app.enable_audit('public.loan_repayments');
select app.enable_audit('public.loan_restructures');
select app.enable_audit('public.loan_reminders');

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.loan_products enable row level security;
alter table public.loans enable row level security;
alter table public.loan_guarantors enable row level security;
alter table public.loan_collaterals enable row level security;
alter table public.loan_documents enable row level security;
alter table public.loan_installments enable row level security;
alter table public.loan_repayments enable row level security;
alter table public.loan_restructures enable row level security;
alter table public.loan_reminders enable row level security;

create policy "staff can read loan products" on public.loan_products for select to authenticated using (true);
create policy "credit config managers add loan products" on public.loan_products for insert to authenticated
  with check (app.has_permission('credit.config'));
create policy "credit config managers edit loan products" on public.loan_products for update to authenticated
  using (app.has_permission('credit.config')) with check (app.has_permission('credit.config'));

-- Credit staff read their branches' loans; Accounts reads them to pay them out and take repayments.
create policy "credit and finance staff read loans" on public.loans for select to authenticated
  using (app.has_branch_permission('credit.read', branch_id) or app.has_branch_permission('accounts.read', branch_id));
create policy "account officers start applications" on public.loans for insert to authenticated
  with check (app.has_branch_permission('credit.manage', branch_id));
create policy "account officers edit draft applications" on public.loans for update to authenticated
  using (status in ('draft', 'returned') and app.has_branch_permission('credit.manage', branch_id))
  with check (app.has_branch_permission('credit.manage', branch_id));
-- No delete policy: applications are withdrawn (cancelled), never deleted.

create policy "credit staff read guarantors" on public.loan_guarantors for select to authenticated
  using (app.has_branch_permission('credit.read', branch_id));
create policy "account officers manage guarantors" on public.loan_guarantors for all to authenticated
  using (app.has_branch_permission('credit.manage', branch_id))
  with check (app.has_branch_permission('credit.manage', (select l.branch_id from public.loans l where l.id = loan_id)));

create policy "credit staff read collateral" on public.loan_collaterals for select to authenticated
  using (app.has_branch_permission('credit.read', branch_id));
create policy "account officers manage collateral" on public.loan_collaterals for all to authenticated
  using (app.has_branch_permission('credit.manage', branch_id))
  with check (app.has_branch_permission('credit.manage', (select l.branch_id from public.loans l where l.id = loan_id)));

create policy "credit staff read loan documents" on public.loan_documents for select to authenticated
  using (app.has_branch_permission('credit.read', branch_id));
create policy "credit staff upload loan documents" on public.loan_documents for insert to authenticated
  with check (
    app.has_branch_permission('credit.manage', (select l.branch_id from public.loans l where l.id = loan_id))
    or app.has_branch_permission('credit.appraise', (select l.branch_id from public.loans l where l.id = loan_id))
  );
create policy "account officers remove draft documents" on public.loan_documents for delete to authenticated
  using (app.has_branch_permission('credit.manage', branch_id));

create policy "credit and finance staff read schedules" on public.loan_installments for select to authenticated
  using (app.has_branch_permission('credit.read', branch_id) or app.has_branch_permission('accounts.read', branch_id));
create policy "credit and finance staff read loan repayments" on public.loan_repayments for select to authenticated
  using (app.has_branch_permission('credit.read', branch_id) or app.has_branch_permission('accounts.read', branch_id));
create policy "credit staff read restructures" on public.loan_restructures for select to authenticated
  using (app.has_branch_permission('credit.read', branch_id));

create policy "credit staff read reminders" on public.loan_reminders for select to authenticated
  using (app.has_branch_permission('credit.read', branch_id));
create policy "account officers record reminders" on public.loan_reminders for insert to authenticated
  with check (app.has_branch_permission('credit.manage', (select l.branch_id from public.loans l where l.id = loan_id)));

-- ---------------------------------------------------------------------------
-- Private storage for loan documents, at <branch_id>/<loan_id>/<file>, so access follows the branch.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('loan-documents', 'loan-documents', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;

create policy "credit staff download loan documents" on storage.objects for select to authenticated
  using (bucket_id = 'loan-documents' and app.has_branch_permission('credit.read', app.storage_path_branch(name)));

create policy "credit staff upload loan documents" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'loan-documents' and (
      app.has_branch_permission('credit.manage', app.storage_path_branch(name))
      or app.has_branch_permission('credit.appraise', app.storage_path_branch(name))
    )
  );
-- No update or delete policies: uploaded files are kept as evidence.

-- ---------------------------------------------------------------------------
-- Function grants
-- ---------------------------------------------------------------------------

revoke all on function public.credit_officers() from public, anon;
revoke all on function public.loan_schedule(numeric, numeric, text, text, text, integer, date, date) from public, anon;
revoke all on function public.submit_loan(uuid) from public, anon;
revoke all on function public.appraise_loan(uuid, text, text, text, text, text, numeric, text) from public, anon;
revoke all on function public.return_loan(uuid, text) from public, anon;
revoke all on function public.decide_loan(uuid, boolean, numeric, text) from public, anon;
revoke all on function public.cancel_loan(uuid, text) from public, anon;
revoke all on function public.reassign_loan_officer(uuid, uuid) from public, anon;
revoke all on function public.request_loan_restructure(uuid, integer, text, numeric, text, text, date, text) from public, anon;
revoke all on function public.decide_loan_restructure(uuid, boolean, text) from public, anon;
revoke all on function public.submit_finance_transaction(uuid) from public, anon;
revoke all on function public.audit_exceptions(numeric) from public, anon;
revoke all on function public.branch_operations(date, date, text, uuid, uuid) from public, anon;

grant execute on function public.credit_officers() to authenticated;
grant execute on function public.loan_schedule(numeric, numeric, text, text, text, integer, date, date) to authenticated;
grant execute on function public.submit_loan(uuid) to authenticated;
grant execute on function public.appraise_loan(uuid, text, text, text, text, text, numeric, text) to authenticated;
grant execute on function public.return_loan(uuid, text) to authenticated;
grant execute on function public.decide_loan(uuid, boolean, numeric, text) to authenticated;
grant execute on function public.cancel_loan(uuid, text) to authenticated;
grant execute on function public.reassign_loan_officer(uuid, uuid) to authenticated;
grant execute on function public.request_loan_restructure(uuid, integer, text, numeric, text, text, date, text) to authenticated;
grant execute on function public.decide_loan_restructure(uuid, boolean, text) to authenticated;
grant execute on function public.submit_finance_transaction(uuid) to authenticated;
grant execute on function public.audit_exceptions(numeric) to authenticated;
grant execute on function public.branch_operations(date, date, text, uuid, uuid) to authenticated;
