-- Accounts: chart of accounts, receipts and payments with approval, the general ledger, bank statement import and
-- reconciliation, and the data behind the financial reports. Follows "Silverkuun ERP Accounts Handoff".
--
-- How money moves through the system
--   receipt:  draft ──submit──▶ submitted ──approve──▶ posted (journal written)
--   payment:  draft ──submit──▶ submitted ──approve──▶ approved ──pay (with proof)──▶ posted (journal written)
--   either can be returned (back to draft for correction) or rejected, always with a reason.
--
--   * Posting rules map each transaction type to its debit and credit accounts. Only the finance configuration
--     permission can change them, and every change is in the audit trail.
--   * Every posted journal balances (debits = credits) and is locked. Mistakes are corrected with a reversal entry.
--   * Nobody approves something they prepared or submitted, and the person who approved a payment can't also pay it.
--   * Members, branches, bank accounts and products are dimensions on journal lines, not separate ledger accounts.

-- ---------------------------------------------------------------------------
-- Department, permissions and roles
-- ---------------------------------------------------------------------------

insert into public.departments (code, name) values ('accounts', 'Accounts');

insert into public.permissions (code, description) values
  ('module.accounts', 'Open the Accounts module'),
  ('accounts.read', 'View the ledger, transactions, bank reconciliations and financial reports'),
  ('accounts.receipts.record', 'Record receipts and attach evidence'),
  ('accounts.payments.request', 'Raise payment requests'),
  ('accounts.payments.pay', 'Record that an approved payment was made, with proof of payment'),
  ('accounts.transactions.approve', 'Approve, return or reject receipts, payment requests and reconciliations'),
  ('accounts.journals.prepare', 'Prepare manual journal entries'),
  ('accounts.journals.post', 'Post and reverse journal entries'),
  ('accounts.bank.reconcile', 'Import bank statements, match lines and prepare bank reconciliations'),
  ('accounts.config.manage', 'Manage the chart of accounts, posting rules and bank accounts');

insert into public.roles (code, department_code, name, description) values
  ('receipts_accountant', 'accounts', 'Receipts Accountant', 'Records and confirms receipts with evidence and links them to members'),
  ('payments_accountant', 'accounts', 'Payments Accountant', 'Prepares payment requests, records payments and reconciles assigned bank accounts'),
  ('regional_accountant', 'accounts', 'Regional Accountant', 'Processes and reviews receipts and payments for a region and reconciles its bank accounts'),
  ('financial_controller', 'accounts', 'Financial Controller', 'Approves receipts, payments, journals and reconciliations; owns the chart of accounts and posting rules');

insert into public.role_permissions (role_code, permission_code) values
  ('receipts_accountant', 'module.accounts'),
  ('receipts_accountant', 'accounts.read'),
  ('receipts_accountant', 'accounts.receipts.record'),
  ('receipts_accountant', 'members.read'),
  ('payments_accountant', 'module.accounts'),
  ('payments_accountant', 'accounts.read'),
  ('payments_accountant', 'accounts.payments.request'),
  ('payments_accountant', 'accounts.payments.pay'),
  ('payments_accountant', 'accounts.bank.reconcile'),
  ('payments_accountant', 'members.read'),
  ('regional_accountant', 'module.accounts'),
  ('regional_accountant', 'accounts.read'),
  ('regional_accountant', 'accounts.receipts.record'),
  ('regional_accountant', 'accounts.payments.request'),
  ('regional_accountant', 'accounts.payments.pay'),
  ('regional_accountant', 'accounts.transactions.approve'),
  ('regional_accountant', 'accounts.journals.prepare'),
  ('regional_accountant', 'accounts.bank.reconcile'),
  ('regional_accountant', 'members.read'),
  ('financial_controller', 'module.accounts'),
  ('financial_controller', 'accounts.read'),
  ('financial_controller', 'accounts.transactions.approve'),
  ('financial_controller', 'accounts.journals.prepare'),
  ('financial_controller', 'accounts.journals.post'),
  ('financial_controller', 'accounts.bank.reconcile'),
  ('financial_controller', 'accounts.config.manage'),
  ('financial_controller', 'members.read'),
  -- Auditors read the books but can't change them.
  ('internal_auditor', 'module.accounts'),
  ('internal_auditor', 'accounts.read');

-- ---------------------------------------------------------------------------
-- Chart of accounts
-- ---------------------------------------------------------------------------

create type public.account_type as enum ('asset', 'liability', 'equity', 'income', 'expense');

create table public.ledger_accounts (
  code text primary key check (code ~ '^[0-9]{4}$'),
  name text not null check (length(trim(name)) > 0),
  account_type public.account_type not null,
  parent_code text references public.ledger_accounts (code) on delete restrict,
  -- Group headings organise the chart; only detail accounts take postings.
  is_group boolean not null default false,
  is_active boolean not null default true,
  -- How movements against this account appear in the cash flow statement. 'cash' marks cash and bank accounts.
  cash_flow_class text not null default 'operating' check (cash_flow_class in ('cash', 'operating', 'investing', 'financing')),
  description text not null default '',
  created_at timestamptz not null default now()
);
create index ledger_accounts_parent_idx on public.ledger_accounts (parent_code);

insert into public.ledger_accounts (code, name, account_type, parent_code, is_group, cash_flow_class, description) values
  ('1000', 'Assets', 'asset', null, true, 'operating', 'Group heading'),
  ('1100', 'Cash and bank', 'asset', '1000', true, 'cash', 'Group heading'),
  ('1110', 'Cash on hand', 'asset', '1100', false, 'cash', 'Physical cash held'),
  ('1120', 'Petty cash', 'asset', '1100', false, 'cash', 'Small approved cash float'),
  ('1130', 'Bank accounts', 'asset', '1100', true, 'cash', 'One detail account per actual bank account'),
  ('1140', 'Payment processor clearing', 'asset', '1100', false, 'cash', 'Amounts held by payment platforms before settlement'),
  ('1150', 'Unidentified receipts', 'asset', '1100', false, 'operating', 'Temporary holding account; assign an owner and clear promptly'),
  ('1200', 'Member loans receivable', 'asset', '1000', true, 'operating', 'Member-by-member loan subledger'),
  ('1210', 'Loans receivable - current', 'asset', '1200', false, 'operating', 'Principal expected within 12 months'),
  ('1220', 'Loans receivable - long term', 'asset', '1200', false, 'operating', 'Principal expected after 12 months'),
  ('1230', 'Accrued loan interest receivable', 'asset', '1200', false, 'operating', 'Interest earned but not yet received'),
  ('1240', 'Allowance for loan losses', 'asset', '1200', false, 'operating', 'Contra-asset for approved expected credit losses'),
  ('1300', 'Other current assets', 'asset', '1000', true, 'operating', 'Group heading'),
  ('1310', 'Accounts receivable', 'asset', '1300', false, 'operating', 'Amounts due from non-member customers or partners'),
  ('1320', 'Staff advances', 'asset', '1300', false, 'operating', 'Recoverable staff advances'),
  ('1330', 'Prepayments and recoverable taxes', 'asset', '1300', false, 'operating', 'Prepaid costs and approved tax credits'),
  ('1400', 'Investments and deposits', 'asset', '1000', true, 'investing', 'Group heading'),
  ('1410', 'Short-term investments', 'asset', '1400', false, 'investing', 'Deposits and investments due within 12 months'),
  ('1420', 'Long-term investments and deposits', 'asset', '1400', false, 'investing', 'Investments or security deposits due later'),
  ('1500', 'Property and equipment', 'asset', '1000', true, 'investing', 'Group heading'),
  ('1510', 'Property and equipment at cost', 'asset', '1500', false, 'investing', 'Tracked in an asset register'),
  ('1520', 'Accumulated depreciation', 'asset', '1500', false, 'operating', 'Contra-asset'),
  ('1600', 'Intangible assets at cost', 'asset', '1000', false, 'investing', 'Capitalised software when policy criteria are met'),
  ('1610', 'Accumulated amortisation', 'asset', '1000', false, 'operating', 'Contra-asset for qualifying software'),
  ('2000', 'Liabilities', 'liability', null, true, 'operating', 'Group heading'),
  ('2100', 'Member funds payable', 'liability', '2000', true, 'operating', 'Member subledger'),
  ('2110', 'Member savings payable', 'liability', '2100', false, 'operating', 'Withdrawable member savings'),
  ('2120', 'Fixed-term savings payable', 'liability', '2100', false, 'operating', 'Savings locked to an approved term'),
  ('2130', 'Matured or liquidation payable', 'liability', '2100', false, 'operating', 'Due to members after maturity or approved withdrawal'),
  ('2140', 'ROI payable', 'liability', '2100', false, 'operating', 'Approved returns due to members'),
  ('2150', 'Unallocated member receipts', 'liability', '2100', false, 'operating', 'Deposits not yet identified'),
  ('2200', 'Trade and operating payables', 'liability', '2000', true, 'operating', 'Group heading'),
  ('2210', 'Supplier payables', 'liability', '2200', false, 'operating', 'Supplier subledger'),
  ('2220', 'Accrued expenses', 'liability', '2200', false, 'operating', 'Costs incurred but not yet invoiced or paid'),
  ('2230', 'Payroll and staff benefits payable', 'liability', '2200', false, 'operating', 'Net payroll and approved benefits due'),
  ('2240', 'Tax and statutory deductions payable', 'liability', '2200', false, 'operating', 'PAYE, withholding tax and similar'),
  ('2250', 'Other current liabilities', 'liability', '2200', false, 'operating', 'Refunds, unclaimed balances and other short-term obligations'),
  ('2300', 'Borrowings', 'liability', '2000', true, 'financing', 'Group heading'),
  ('2310', 'Borrowings - current', 'liability', '2300', false, 'financing', 'Due within 12 months'),
  ('2320', 'Borrowings - long term', 'liability', '2300', false, 'financing', 'Due after 12 months'),
  ('3000', 'Accumulated funds / equity', 'equity', null, true, 'financing', 'Group heading'),
  ('3100', 'Member capital / share capital', 'equity', '3000', false, 'financing', 'Member capital tracked by member'),
  ('3200', 'Accumulated surplus / retained earnings', 'equity', '3000', false, 'financing', 'Prior period accumulated results'),
  ('3300', 'Current year surplus / deficit', 'equity', '3000', false, 'financing', 'Closed to accumulated surplus at year end'),
  ('4000', 'Income', 'income', null, true, 'operating', 'Group heading'),
  ('4100', 'Loan interest income', 'income', '4000', false, 'operating', 'Interest income under approved policy'),
  ('4200', 'Investment income', 'income', '4000', false, 'operating', 'Interest or income from investments'),
  ('4300', 'Fees and commission income', 'income', '4000', false, 'operating', 'Approved service fees and commissions'),
  ('4400', 'Other operating income', 'income', '4000', false, 'operating', 'Other routine income'),
  ('5000', 'Expenses', 'expense', null, true, 'operating', 'Group heading'),
  ('5100', 'ROI expense', 'expense', '5000', false, 'operating', 'Member returns recognised as an expense'),
  ('5200', 'Staff costs', 'expense', '5000', false, 'operating', 'Salaries, benefits, commissions'),
  ('5300', 'Branch and administration costs', 'expense', '5000', false, 'operating', 'Rent, utilities, office, communication'),
  ('5350', 'Bank charges', 'expense', '5000', false, 'operating', 'Bank fees and charges'),
  ('5400', 'Professional and audit fees', 'expense', '5000', false, 'operating', 'External professional services'),
  ('5500', 'Depreciation and amortisation', 'expense', '5000', false, 'operating', 'Periodic asset expense'),
  ('5600', 'Loan impairment expense', 'expense', '5000', false, 'operating', 'Approved provision/impairment expense'),
  ('5700', 'Tax expense', 'expense', '5000', false, 'operating', 'Tax expense where applicable'),
  ('5800', 'Other operating expenses', 'expense', '5000', false, 'operating', 'Other approved operating costs');

create or replace function app.ledger_accounts_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_parent public.ledger_accounts;
begin
  if tg_op = 'UPDATE' and new.code is distinct from old.code then
    raise exception 'an account code can''t be changed; create a new account instead' using errcode = 'check_violation';
  end if;
  if new.parent_code is not null then
    select * into v_parent from public.ledger_accounts where code = new.parent_code;
    if not v_parent.is_group then
      raise exception 'the parent must be a group heading' using errcode = 'check_violation';
    end if;
    if v_parent.account_type <> new.account_type then
      raise exception 'an account must have the same type as its parent heading' using errcode = 'check_violation';
    end if;
  end if;
  if tg_op = 'UPDATE' and new.is_group and not old.is_group
     and exists (select 1 from public.journal_lines l where l.account_code = new.code) then
    raise exception 'this account already has postings, so it can''t become a group heading' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Bank and cash accounts
-- ---------------------------------------------------------------------------

create table public.bank_accounts (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches (id) on delete restrict,
  name text not null check (length(trim(name)) > 0),
  kind text not null default 'bank' check (kind in ('bank', 'cash')),
  bank_name text,
  account_number text,
  ledger_account_code text not null references public.ledger_accounts (code) on delete restrict,
  currency text not null default 'NGN' check (currency ~ '^[A-Z]{3}$'),
  -- Statement column headings, saved once per account so later imports need no mapping.
  import_mapping jsonb not null default
    '{"date": "Date", "description": "Description", "reference": "Reference", "debit": "Debit", "credit": "Credit", "balance": "Balance"}',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
-- A bank account has its own ledger account so its balance can be reconciled on its own.
create unique index bank_accounts_ledger_idx on public.bank_accounts (ledger_account_code) where kind = 'bank';
create index bank_accounts_branch_idx on public.bank_accounts (branch_id);

create or replace function app.bank_accounts_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.ledger_accounts a
    where a.code = new.ledger_account_code and a.cash_flow_class = 'cash' and not a.is_group and a.is_active
  ) then
    raise exception 'link a cash or bank detail account from the chart of accounts' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger bank_accounts_guard
  before insert or update on public.bank_accounts
  for each row execute function app.bank_accounts_guard();

-- ---------------------------------------------------------------------------
-- Posting rules: which accounts each transaction type debits and credits
-- ---------------------------------------------------------------------------

create table public.posting_rules (
  transaction_type text primary key check (transaction_type ~ '^[a-z][a-z0-9_]*$'),
  name text not null,
  direction text not null check (direction in ('receipt', 'payment')),
  -- The bank side is always the bank account chosen on the transaction, so it is left null here.
  debit_account text references public.ledger_accounts (code),
  credit_account text references public.ledger_accounts (code),
  -- Receipts only: where the interest part of the amount goes (loan repayments).
  interest_account text references public.ledger_accounts (code),
  requires_member boolean not null default false,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  constraint posting_rules_bank_side check (
    (direction = 'receipt' and debit_account is null and credit_account is not null)
    or (direction = 'payment' and credit_account is null and debit_account is not null and interest_account is null)
  )
);

insert into public.posting_rules (transaction_type, name, direction, debit_account, credit_account, interest_account, requires_member, sort_order) values
  ('member_savings', 'Member savings deposit', 'receipt', null, '2110', null, true, 10),
  ('member_capital', 'Member capital contribution', 'receipt', null, '3100', null, true, 20),
  ('loan_repayment', 'Loan repayment (principal and interest)', 'receipt', null, '1210', '4100', true, 30),
  ('fee_income', 'Fees and commission received', 'receipt', null, '4300', null, false, 40),
  ('investment_income', 'Investment income received', 'receipt', null, '4200', null, false, 50),
  ('other_income', 'Other income received', 'receipt', null, '4400', null, false, 60),
  ('unidentified_receipt', 'Unidentified deposit', 'receipt', null, '1150', null, false, 70),
  ('savings_withdrawal', 'Member savings withdrawal or refund', 'payment', '2110', null, null, true, 110),
  ('maturity_payout', 'Matured or liquidated plan payout', 'payment', '2130', null, null, true, 120),
  ('roi_payment', 'ROI paid to member', 'payment', '2140', null, null, true, 130),
  ('loan_disbursement', 'Loan disbursement', 'payment', '1210', null, null, true, 140),
  ('supplier_payment', 'Supplier payment', 'payment', '2210', null, null, false, 150),
  ('staff_costs', 'Salaries and staff costs', 'payment', '5200', null, null, false, 160),
  ('admin_expense', 'Branch and administration costs', 'payment', '5300', null, null, false, 170),
  ('professional_fees', 'Professional and audit fees', 'payment', '5400', null, null, false, 180),
  ('bank_charges', 'Bank charges', 'payment', '5350', null, null, false, 190),
  ('tax_remittance', 'Tax and statutory remittance', 'payment', '2240', null, null, false, 200),
  ('asset_purchase', 'Property and equipment purchase', 'payment', '1510', null, null, false, 210),
  ('other_expense', 'Other operating expense', 'payment', '5800', null, null, false, 220);

create or replace function app.posting_rules_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and (new.transaction_type is distinct from old.transaction_type or new.direction is distinct from old.direction) then
    raise exception 'a transaction type''s code and direction can''t change' using errcode = 'check_violation';
  end if;
  if exists (
    select 1 from public.ledger_accounts a
    where a.code in (new.debit_account, new.credit_account, new.interest_account) and (a.is_group or not a.is_active)
  ) then
    raise exception 'posting rules must use active detail accounts, not group headings' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger posting_rules_guard
  before insert or update on public.posting_rules
  for each row execute function app.posting_rules_guard();

-- ---------------------------------------------------------------------------
-- Journal entries (the general ledger)
-- ---------------------------------------------------------------------------

create type public.journal_status as enum ('draft', 'posted');
create sequence public.journal_entry_seq;

create table public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  entry_no text not null unique,
  branch_id uuid not null references public.branches (id) on delete restrict,
  entry_date date not null,
  description text not null check (length(trim(description)) > 0),
  source text not null default 'manual' check (source in ('manual', 'transaction', 'reversal')),
  transaction_id uuid,
  status public.journal_status not null default 'draft',
  reverses_entry_id uuid unique references public.journal_entries (id),
  reversed_by_entry_id uuid unique references public.journal_entries (id),
  reversal_reason text,
  created_by uuid not null default auth.uid() references public.staff (id),
  created_at timestamptz not null default now(),
  posted_by uuid references public.staff (id),
  posted_at timestamptz
);
create index journal_entries_branch_date_idx on public.journal_entries (branch_id, entry_date);
create index journal_entries_date_idx on public.journal_entries (entry_date) where status = 'posted';
create index journal_entries_transaction_idx on public.journal_entries (transaction_id);

create table public.journal_lines (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.journal_entries (id) on delete cascade,
  line_no integer not null default 0,
  branch_id uuid not null references public.branches (id),
  account_code text not null references public.ledger_accounts (code) on delete restrict,
  debit numeric(14, 2) not null default 0 check (debit >= 0),
  credit numeric(14, 2) not null default 0 check (credit >= 0),
  member_id uuid references public.members (id),
  bank_account_id uuid references public.bank_accounts (id),
  description text,
  constraint journal_lines_one_side check ((debit > 0 and credit = 0) or (credit > 0 and debit = 0))
);
create index journal_lines_entry_idx on public.journal_lines (entry_id);
create index journal_lines_account_idx on public.journal_lines (account_code);
create index journal_lines_member_idx on public.journal_lines (member_id) where member_id is not null;
create index journal_lines_bank_idx on public.journal_lines (bank_account_id) where bank_account_id is not null;

create trigger ledger_accounts_guard
  before insert or update on public.ledger_accounts
  for each row execute function app.ledger_accounts_guard();

create or replace function app.journal_entries_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'posted journal entries are never deleted; reverse them instead' using errcode = 'insufficient_privilege';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    new.entry_no := 'JV-' || lpad(nextval('public.journal_entry_seq')::text, 6, '0');
    new.created_at := now();
    if not app.in_workflow() then
      new.status := 'draft';
      new.source := 'manual';
      new.transaction_id := null;
      new.reverses_entry_id := null;
      new.reversed_by_entry_id := null;
      new.reversal_reason := null;
      new.created_by := auth.uid();
      new.posted_by := null;
      new.posted_at := null;
    end if;
    return new;
  end if;

  if app.in_workflow() then
    return new;
  end if;
  if old.status <> 'draft' then
    raise exception 'posted journal entries are locked; reverse them instead' using errcode = 'insufficient_privilege';
  end if;
  if new.status is distinct from old.status
     or new.entry_no is distinct from old.entry_no
     or new.source is distinct from old.source
     or new.transaction_id is distinct from old.transaction_id
     or new.reverses_entry_id is distinct from old.reverses_entry_id
     or new.reversed_by_entry_id is distinct from old.reversed_by_entry_id
     or new.created_by is distinct from old.created_by
     or new.posted_by is distinct from old.posted_by
     or new.posted_at is distinct from old.posted_at then
    raise exception 'journal status changes only through posting and reversal' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger journal_entries_guard
  before insert or update or delete on public.journal_entries
  for each row execute function app.journal_entries_guard();

create or replace function app.journal_lines_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry public.journal_entries;
  v_account public.ledger_accounts;
begin
  select * into v_entry from public.journal_entries where id = coalesce(new.entry_id, old.entry_id);

  -- Lines of a draft go when the draft is deleted; posted entries can't be deleted (see journal_entries_guard).
  if tg_op = 'DELETE' then
    if v_entry.status is not null and v_entry.status <> 'draft' and not app.in_workflow() then
      raise exception 'posted journal lines are locked' using errcode = 'insufficient_privilege';
    end if;
    return old;
  end if;

  if v_entry.status <> 'draft' and not app.in_workflow() then
    raise exception 'posted journal lines are locked' using errcode = 'insufficient_privilege';
  end if;

  select * into v_account from public.ledger_accounts where code = new.account_code;
  if v_account.is_group or not v_account.is_active then
    raise exception 'post to an active detail account, not a group heading (%)', new.account_code using errcode = 'check_violation';
  end if;

  new.branch_id := v_entry.branch_id;
  if new.bank_account_id is null then
    -- A bank ledger belongs to one bank account; a shared cash ledger resolves to the entry branch's till.
    select b.id into new.bank_account_id from public.bank_accounts b
    where b.ledger_account_code = new.account_code and (b.kind = 'bank' or b.branch_id = v_entry.branch_id)
    order by b.kind, b.created_at
    limit 1;
  elsif not exists (select 1 from public.bank_accounts b where b.id = new.bank_account_id and b.ledger_account_code = new.account_code) then
    raise exception 'the bank account doesn''t match the ledger account on this line' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger journal_lines_guard
  before insert or update or delete on public.journal_lines
  for each row execute function app.journal_lines_guard();

-- Raises unless the entry has at least two lines and debits equal credits.
create or replace function app.assert_balanced(p_entry_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_debit numeric;
  v_credit numeric;
  v_lines integer;
begin
  select coalesce(sum(debit), 0), coalesce(sum(credit), 0), count(*) into v_debit, v_credit, v_lines
  from public.journal_lines where entry_id = p_entry_id;
  if v_lines < 2 then
    raise exception 'a journal entry needs at least two lines' using errcode = 'check_violation';
  end if;
  if v_debit <> v_credit then
    raise exception 'debits (%) must equal credits (%)', v_debit, v_credit using errcode = 'check_violation';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Receipts and payments
-- ---------------------------------------------------------------------------

create type public.finance_status as enum ('draft', 'submitted', 'returned', 'rejected', 'approved', 'posted', 'reversed');
create sequence public.receipt_no_seq;
create sequence public.payment_no_seq;

create table public.finance_transactions (
  id uuid primary key default gen_random_uuid(),
  txn_no text not null unique,
  branch_id uuid not null references public.branches (id) on delete restrict,
  direction text not null check (direction in ('receipt', 'payment')),
  transaction_type text not null references public.posting_rules (transaction_type),
  status public.finance_status not null default 'draft',
  txn_date date not null,
  amount numeric(14, 2) not null check (amount > 0),
  interest_amount numeric(14, 2) not null default 0 check (interest_amount >= 0),
  bank_account_id uuid not null references public.bank_accounts (id),
  member_id uuid references public.members (id),
  counterparty text,
  reference text,
  description text not null check (length(trim(description)) > 0),
  -- Where the transaction came from, when it wasn't keyed in from scratch.
  contribution_id uuid unique references public.contributions (id),
  statement_line_id uuid unique,
  decision_reason text,
  journal_entry_id uuid references public.journal_entries (id),
  created_by uuid not null default auth.uid() references public.staff (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  submitted_by uuid references public.staff (id),
  submitted_at timestamptz,
  approved_by uuid references public.staff (id),
  approved_at timestamptz,
  paid_by uuid references public.staff (id),
  paid_at timestamptz,
  posted_at timestamptz,
  constraint finance_transactions_interest check (interest_amount < amount)
);
create index finance_transactions_branch_status_idx on public.finance_transactions (branch_id, status);
create index finance_transactions_member_idx on public.finance_transactions (member_id) where member_id is not null;
-- The same reference can't be used twice on one bank account (rejected attempts don't count).
create unique index finance_transactions_reference_idx
  on public.finance_transactions (bank_account_id, lower(trim(reference)))
  where reference is not null and length(trim(reference)) > 0 and status <> 'rejected';

alter table public.journal_entries
  add constraint journal_entries_transaction_fk foreign key (transaction_id) references public.finance_transactions (id);

create table public.finance_attachments (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.finance_transactions (id) on delete restrict,
  branch_id uuid not null references public.branches (id),
  kind text not null check (kind in ('supporting', 'payment_proof')),
  file_name text not null,
  storage_path text not null unique,
  mime_type text not null check (mime_type in ('application/pdf', 'image/jpeg', 'image/png')),
  size_bytes integer not null check (size_bytes > 0 and size_bytes <= 10485760),
  uploaded_by uuid not null default auth.uid() references public.staff (id),
  uploaded_at timestamptz not null default now()
);
create index finance_attachments_transaction_idx on public.finance_attachments (transaction_id);

-- ---------------------------------------------------------------------------
-- Bank statements and reconciliation
-- ---------------------------------------------------------------------------

create table public.bank_statement_imports (
  id uuid primary key default gen_random_uuid(),
  bank_account_id uuid not null references public.bank_accounts (id),
  branch_id uuid not null references public.branches (id),
  file_name text not null,
  storage_path text,
  file_sha256 text not null,
  line_count integer not null default 0,
  duplicate_count integer not null default 0,
  statement_from date,
  statement_to date,
  closing_balance numeric(14, 2),
  imported_by uuid not null default auth.uid() references public.staff (id),
  imported_at timestamptz not null default now(),
  constraint bank_statement_imports_once unique (bank_account_id, file_sha256)
);

create type public.statement_line_status as enum ('unmatched', 'matched', 'excluded');

create table public.bank_matches (
  id uuid primary key default gen_random_uuid(),
  bank_account_id uuid not null references public.bank_accounts (id),
  branch_id uuid not null references public.branches (id),
  method text not null check (method in ('auto', 'manual', 'posted')),
  note text,
  matched_by uuid not null default auth.uid() references public.staff (id),
  matched_at timestamptz not null default now()
);

create table public.bank_statement_lines (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.bank_statement_imports (id),
  bank_account_id uuid not null references public.bank_accounts (id),
  branch_id uuid not null references public.branches (id),
  row_no integer not null,
  line_date date not null,
  description text not null default '',
  reference text,
  -- Money into the account is positive, money out is negative.
  amount numeric(14, 2) not null check (amount <> 0),
  running_balance numeric(14, 2),
  fingerprint text not null,
  status public.statement_line_status not null default 'unmatched',
  match_id uuid references public.bank_matches (id),
  suggested_type text references public.posting_rules (transaction_type),
  suggestion_reason text,
  exclusion_reason text,
  constraint bank_statement_lines_no_duplicates unique (bank_account_id, fingerprint),
  constraint bank_statement_lines_match check ((status = 'matched') = (match_id is not null))
);
create index bank_statement_lines_account_idx on public.bank_statement_lines (bank_account_id, status, line_date);

alter table public.finance_transactions
  add constraint finance_transactions_statement_line_fk foreign key (statement_line_id) references public.bank_statement_lines (id);

create table public.bank_match_ledger_lines (
  match_id uuid not null references public.bank_matches (id) on delete cascade,
  journal_line_id uuid not null unique references public.journal_lines (id),
  primary key (match_id, journal_line_id)
);

-- Keyword rules that suggest a transaction type for an imported statement line.
create table public.bank_categorisation_rules (
  id uuid primary key default gen_random_uuid(),
  pattern text not null check (length(trim(pattern)) > 0),
  transaction_type text not null references public.posting_rules (transaction_type),
  created_by uuid default auth.uid() references public.staff (id),
  created_at timestamptz not null default now()
);

insert into public.bank_categorisation_rules (pattern, transaction_type) values
  ('CHARGE', 'bank_charges'),
  ('COMMISSION ON TURNOVER', 'bank_charges'),
  ('SMS ALERT', 'bank_charges'),
  ('STAMP DUTY', 'bank_charges'),
  ('MAINTENANCE FEE', 'bank_charges');

create table public.bank_reconciliations (
  id uuid primary key default gen_random_uuid(),
  bank_account_id uuid not null references public.bank_accounts (id),
  branch_id uuid not null references public.branches (id),
  period_end date not null,
  statement_balance numeric(14, 2) not null,
  ledger_balance numeric(14, 2) not null,
  unmatched_statement_total numeric(14, 2) not null,
  unmatched_ledger_total numeric(14, 2) not null,
  difference numeric(14, 2) not null,
  notes text,
  status text not null default 'draft' check (status in ('draft', 'completed')),
  prepared_by uuid not null default auth.uid() references public.staff (id),
  prepared_at timestamptz not null default now(),
  completed_by uuid references public.staff (id),
  completed_at timestamptz,
  constraint bank_reconciliations_once unique (bank_account_id, period_end)
);

-- ---------------------------------------------------------------------------
-- Guards on receipts and payments
-- ---------------------------------------------------------------------------

create or replace function app.finance_transactions_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rule public.posting_rules;
  v_bank public.bank_accounts;
  v_contribution public.contributions;
  v_line public.bank_statement_lines;
  v_expected_type text;
begin
  if tg_op = 'UPDATE' and app.in_workflow() then
    new.updated_at := now();
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if old.status not in ('draft', 'returned') then
      raise exception 'this transaction is % and can''t be edited', old.status using errcode = 'check_violation';
    end if;
    if new.status is distinct from old.status
       or new.txn_no is distinct from old.txn_no
       or new.direction is distinct from old.direction
       or new.contribution_id is distinct from old.contribution_id
       or new.statement_line_id is distinct from old.statement_line_id
       or new.journal_entry_id is distinct from old.journal_entry_id
       or new.decision_reason is distinct from old.decision_reason
       or new.created_by is distinct from old.created_by
       or new.created_at is distinct from old.created_at
       or new.submitted_by is distinct from old.submitted_by
       or new.submitted_at is distinct from old.submitted_at
       or new.approved_by is distinct from old.approved_by
       or new.approved_at is distinct from old.approved_at
       or new.paid_by is distinct from old.paid_by
       or new.paid_at is distinct from old.paid_at
       or new.posted_at is distinct from old.posted_at then
      raise exception 'status and approval details change only through the approval workflow' using errcode = 'insufficient_privilege';
    end if;
    new.updated_at := now();
  end if;

  if tg_op = 'INSERT' then
    new.txn_no := case when new.direction = 'receipt'
      then 'RCT-' || lpad(nextval('public.receipt_no_seq')::text, 6, '0')
      else 'PAY-' || lpad(nextval('public.payment_no_seq')::text, 6, '0') end;
    new.status := 'draft';
    new.created_by := auth.uid();
    new.created_at := now();
    new.updated_at := now();
    new.decision_reason := null;
    new.journal_entry_id := null;
    new.submitted_by := null;
    new.submitted_at := null;
    new.approved_by := null;
    new.approved_at := null;
    new.paid_by := null;
    new.paid_at := null;
    new.posted_at := null;
  end if;

  select * into v_rule from public.posting_rules where transaction_type = new.transaction_type;
  if not v_rule.is_active then
    raise exception 'that transaction type is not in use' using errcode = 'check_violation';
  end if;
  if v_rule.direction <> new.direction then
    raise exception 'a % type can''t be used on a %', v_rule.direction, new.direction using errcode = 'check_violation';
  end if;

  select * into v_bank from public.bank_accounts where id = new.bank_account_id;
  if not v_bank.is_active then
    raise exception 'that bank account is closed' using errcode = 'check_violation';
  end if;
  new.branch_id := v_bank.branch_id;

  if new.txn_date > current_date then
    raise exception 'the transaction date can''t be in the future' using errcode = 'check_violation';
  end if;
  if new.interest_amount > 0 and v_rule.interest_account is null then
    raise exception 'only loan repayments have an interest part' using errcode = 'check_violation';
  end if;
  if v_rule.requires_member and new.member_id is null then
    raise exception 'choose the member this % is for', new.direction using errcode = 'check_violation';
  end if;
  if new.member_id is not null
     and not exists (select 1 from public.members m where m.id = new.member_id and m.status = 'approved') then
    raise exception 'transactions can only be linked to approved members' using errcode = 'check_violation';
  end if;

  if new.contribution_id is not null then
    select * into v_contribution from public.contributions where id = new.contribution_id;
    if v_contribution.verified_at is null then
      raise exception 'the contribution must be verified by Administration first' using errcode = 'check_violation';
    end if;
    v_expected_type := 'member_savings';
    if v_contribution.kind = 'reversal' then
      v_expected_type := 'savings_withdrawal';
    end if;
    if new.transaction_type <> v_expected_type then
      raise exception 'contributions post as member savings deposits; reversals as savings withdrawals' using errcode = 'check_violation';
    end if;
    if new.amount <> abs(v_contribution.amount) or new.member_id is distinct from v_contribution.member_id then
      raise exception 'the amount and member must match the contribution' using errcode = 'check_violation';
    end if;
  end if;

  if new.statement_line_id is not null then
    select * into v_line from public.bank_statement_lines where id = new.statement_line_id;
    if v_line.bank_account_id <> new.bank_account_id then
      raise exception 'the statement line belongs to a different bank account' using errcode = 'check_violation';
    end if;
    if v_line.status <> 'unmatched' then
      raise exception 'that statement line is already matched or excluded' using errcode = 'check_violation';
    end if;
    if abs(v_line.amount) <> new.amount or (v_line.amount > 0) <> (new.direction = 'receipt') then
      raise exception 'the amount and direction must match the statement line' using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

create trigger finance_transactions_guard
  before insert or update on public.finance_transactions
  for each row execute function app.finance_transactions_guard();

create or replace function app.finance_attachments_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_txn public.finance_transactions;
begin
  select * into v_txn from public.finance_transactions where id = new.transaction_id;
  new.branch_id := v_txn.branch_id;
  new.uploaded_by := auth.uid();
  new.uploaded_at := now();
  if new.kind = 'supporting' and v_txn.status not in ('draft', 'returned') then
    raise exception 'supporting documents are added while the transaction is a draft or returned' using errcode = 'check_violation';
  end if;
  if new.kind = 'payment_proof' and v_txn.status <> 'approved' then
    raise exception 'proof of payment is added once the payment is approved' using errcode = 'check_violation';
  end if;
  if new.storage_path not like v_txn.branch_id::text || '/' || v_txn.id::text || '/%' then
    raise exception 'storage path must sit under the transaction''s folder' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger finance_attachments_guard
  before insert on public.finance_attachments
  for each row execute function app.finance_attachments_guard();

-- ---------------------------------------------------------------------------
-- Posting
-- ---------------------------------------------------------------------------

-- Writes and posts the balanced journal for a receipt or payment, then matches its bank line to the statement line
-- it came from, if any. Called from the workflow functions below.
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
    insert into public.journal_lines (entry_id, line_no, account_code, credit, member_id, description)
    values (v_entry_id, 2, v_rule.credit_account, v_txn.amount - v_txn.interest_amount, v_txn.member_id, v_txn.description);
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
-- Receipt and payment workflow
-- ---------------------------------------------------------------------------

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

create or replace function public.approve_finance_transaction(p_id uuid)
returns public.finance_transactions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_txn public.finance_transactions;
begin
  select * into v_txn from public.finance_transactions where id = p_id for update;
  if not found or not app.has_branch_permission('accounts.transactions.approve', v_txn.branch_id) then
    raise exception 'transaction not found' using errcode = 'no_data_found';
  end if;
  if v_txn.status <> 'submitted' then
    raise exception 'only submitted transactions can be approved' using errcode = 'check_violation';
  end if;
  if auth.uid() in (v_txn.created_by, v_txn.submitted_by) then
    raise exception 'you prepared this transaction, so someone else must approve it' using errcode = 'insufficient_privilege';
  end if;

  perform app.begin_workflow();
  update public.finance_transactions
     set status = 'approved', approved_by = auth.uid(), approved_at = now()
   where id = p_id;
  perform app.end_workflow();

  -- Receipts post as soon as they are confirmed; payments wait for proof that the money went out.
  if v_txn.direction = 'receipt' then
    perform app.post_finance_transaction(p_id);
  end if;

  select * into v_txn from public.finance_transactions where id = p_id;
  return v_txn;
end;
$$;

create or replace function public.decline_finance_transaction(p_id uuid, p_outcome text, p_reason text)
returns public.finance_transactions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_txn public.finance_transactions;
begin
  select * into v_txn from public.finance_transactions where id = p_id for update;
  if not found or not app.has_branch_permission('accounts.transactions.approve', v_txn.branch_id) then
    raise exception 'transaction not found' using errcode = 'no_data_found';
  end if;
  if p_outcome not in ('returned', 'rejected') then
    raise exception 'choose to return or reject' using errcode = 'check_violation';
  end if;
  if v_txn.status <> 'submitted' then
    raise exception 'only submitted transactions can be returned or rejected' using errcode = 'check_violation';
  end if;
  if auth.uid() in (v_txn.created_by, v_txn.submitted_by) then
    raise exception 'you prepared this transaction, so someone else must review it' using errcode = 'insufficient_privilege';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'give a reason' using errcode = 'check_violation';
  end if;

  perform app.begin_workflow();
  update public.finance_transactions
     set status = p_outcome::public.finance_status, decision_reason = trim(p_reason)
   where id = p_id
   returning * into v_txn;
  perform app.end_workflow();
  return v_txn;
end;
$$;

create or replace function public.pay_finance_transaction(p_id uuid)
returns public.finance_transactions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_txn public.finance_transactions;
begin
  select * into v_txn from public.finance_transactions where id = p_id for update;
  if not found or not app.has_branch_permission('accounts.payments.pay', v_txn.branch_id) then
    raise exception 'transaction not found' using errcode = 'no_data_found';
  end if;
  if v_txn.direction <> 'payment' or v_txn.status <> 'approved' then
    raise exception 'only approved payments can be marked as paid' using errcode = 'check_violation';
  end if;
  if auth.uid() = v_txn.approved_by then
    raise exception 'you approved this payment, so someone else must make it' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from public.finance_attachments a where a.transaction_id = p_id and a.kind = 'payment_proof') then
    raise exception 'attach proof of payment first' using errcode = 'check_violation';
  end if;

  perform app.begin_workflow();
  update public.finance_transactions set paid_by = auth.uid(), paid_at = now() where id = p_id;
  perform app.end_workflow();
  perform app.post_finance_transaction(p_id);

  select * into v_txn from public.finance_transactions where id = p_id;
  return v_txn;
end;
$$;

-- ---------------------------------------------------------------------------
-- Manual journals: posting and reversal
-- ---------------------------------------------------------------------------

create or replace function public.post_journal_entry(p_id uuid)
returns public.journal_entries
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry public.journal_entries;
begin
  select * into v_entry from public.journal_entries where id = p_id for update;
  if not found or not app.has_branch_permission('accounts.journals.post', v_entry.branch_id) then
    raise exception 'journal entry not found' using errcode = 'no_data_found';
  end if;
  if v_entry.status <> 'draft' then
    raise exception 'this entry is already posted' using errcode = 'check_violation';
  end if;
  if v_entry.created_by = auth.uid() then
    raise exception 'you prepared this entry, so someone else must post it' using errcode = 'insufficient_privilege';
  end if;
  if v_entry.entry_date > current_date then
    raise exception 'entries can''t be posted with a future date' using errcode = 'check_violation';
  end if;
  perform app.assert_balanced(p_id);

  perform app.begin_workflow();
  update public.journal_entries set status = 'posted', posted_by = auth.uid(), posted_at = now()
   where id = p_id returning * into v_entry;
  perform app.end_workflow();
  return v_entry;
end;
$$;

create or replace function public.reverse_journal_entry(p_id uuid, p_reason text, p_date date default current_date)
returns public.journal_entries
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry public.journal_entries;
  v_reversal public.journal_entries;
begin
  select * into v_entry from public.journal_entries where id = p_id for update;
  if not found or not app.has_branch_permission('accounts.journals.post', v_entry.branch_id) then
    raise exception 'journal entry not found' using errcode = 'no_data_found';
  end if;
  if v_entry.status <> 'posted' then
    raise exception 'only posted entries can be reversed' using errcode = 'check_violation';
  end if;
  if v_entry.reversed_by_entry_id is not null then
    raise exception 'this entry has already been reversed' using errcode = 'check_violation';
  end if;
  if v_entry.reverses_entry_id is not null then
    raise exception 'a reversal can''t itself be reversed; post a new entry instead' using errcode = 'check_violation';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'say why this entry is being reversed' using errcode = 'check_violation';
  end if;
  if p_date < v_entry.entry_date or p_date > current_date then
    raise exception 'the reversal date must be between the original date and today' using errcode = 'check_violation';
  end if;

  perform app.begin_workflow();
  insert into public.journal_entries
    (branch_id, entry_date, description, source, transaction_id, status, reverses_entry_id, reversal_reason, created_by, posted_by, posted_at)
  values
    (v_entry.branch_id, p_date, 'Reversal of ' || v_entry.entry_no || ': ' || trim(p_reason), 'reversal', null, 'draft', v_entry.id,
     trim(p_reason), auth.uid(), auth.uid(), now())
  returning * into v_reversal;

  insert into public.journal_lines (entry_id, line_no, account_code, debit, credit, member_id, bank_account_id, description)
  select v_reversal.id, l.line_no, l.account_code, l.credit, l.debit, l.member_id, l.bank_account_id, l.description
  from public.journal_lines l where l.entry_id = v_entry.id;

  perform app.assert_balanced(v_reversal.id);
  update public.journal_entries set status = 'posted' where id = v_reversal.id returning * into v_reversal;
  update public.journal_entries set reversed_by_entry_id = v_reversal.id, reversal_reason = trim(p_reason) where id = v_entry.id;
  if v_entry.transaction_id is not null then
    update public.finance_transactions set status = 'reversed', decision_reason = trim(p_reason) where id = v_entry.transaction_id;
  end if;
  perform app.end_workflow();
  return v_reversal;
end;
$$;

-- ---------------------------------------------------------------------------
-- Bank statement import, matching and reconciliation
-- ---------------------------------------------------------------------------

-- Saves the statement column headings for a bank account so they need mapping only once.
create or replace function public.save_bank_import_mapping(p_bank_account_id uuid, p_mapping jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bank public.bank_accounts;
begin
  select * into v_bank from public.bank_accounts where id = p_bank_account_id;
  if not found or not app.has_branch_permission('accounts.bank.reconcile', v_bank.branch_id) then
    raise exception 'bank account not found' using errcode = 'no_data_found';
  end if;
  if jsonb_typeof(p_mapping) <> 'object' or not (p_mapping ?& array['date', 'description', 'debit', 'credit']) then
    raise exception 'map at least the date, description, debit and credit columns' using errcode = 'check_violation';
  end if;
  update public.bank_accounts set import_mapping = p_mapping where id = p_bank_account_id;
end;
$$;

-- p_lines is an array of {date, description, reference, amount, balance} objects, already parsed by the app.
-- Lines already imported (same date, amount, reference, description and balance) are skipped and counted.
create or replace function public.import_bank_statement(
  p_bank_account_id uuid,
  p_file_name text,
  p_storage_path text,
  p_file_sha256 text,
  p_lines jsonb
)
returns public.bank_statement_imports
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bank public.bank_accounts;
  v_import public.bank_statement_imports;
  v_line jsonb;
  v_row integer := 0;
  v_inserted integer := 0;
  v_amount numeric(14, 2);
  v_description text;
  v_suggestion public.bank_categorisation_rules;
begin
  select * into v_bank from public.bank_accounts where id = p_bank_account_id;
  if not found or not app.has_branch_permission('accounts.bank.reconcile', v_bank.branch_id) then
    raise exception 'bank account not found' using errcode = 'no_data_found';
  end if;
  if v_bank.kind <> 'bank' then
    raise exception 'statements are imported for bank accounts only' using errcode = 'check_violation';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'the statement has no lines' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.bank_statement_imports i where i.bank_account_id = p_bank_account_id and i.file_sha256 = p_file_sha256) then
    raise exception 'this statement file has already been imported' using errcode = 'check_violation';
  end if;

  insert into public.bank_statement_imports (bank_account_id, branch_id, file_name, storage_path, file_sha256)
  values (p_bank_account_id, v_bank.branch_id, p_file_name, p_storage_path, p_file_sha256)
  returning * into v_import;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_row := v_row + 1;
    v_amount := (v_line ->> 'amount')::numeric(14, 2);
    v_description := coalesce(trim(v_line ->> 'description'), '');
    if v_amount is null or v_amount = 0 then
      continue;
    end if;

    select r.* into v_suggestion from public.bank_categorisation_rules r
    where upper(v_description) like '%' || upper(r.pattern) || '%'
    order by length(r.pattern) desc
    limit 1;

    insert into public.bank_statement_lines
      (import_id, bank_account_id, branch_id, row_no, line_date, description, reference, amount, running_balance, fingerprint,
       suggested_type, suggestion_reason)
    values (
      v_import.id, p_bank_account_id, v_bank.branch_id, v_row, (v_line ->> 'date')::date, v_description,
      nullif(trim(v_line ->> 'reference'), ''), v_amount, (v_line ->> 'balance')::numeric(14, 2),
      md5(concat_ws('|', v_line ->> 'date', v_amount::text, upper(coalesce(trim(v_line ->> 'reference'), '')),
                    upper(v_description), (v_line ->> 'balance')::numeric(14, 2)::text)),
      v_suggestion.transaction_type,
      case when v_suggestion.id is not null then 'Description contains "' || v_suggestion.pattern || '"' end
    )
    on conflict (bank_account_id, fingerprint) do nothing;
    if found then
      v_inserted := v_inserted + 1;
    end if;
  end loop;

  update public.bank_statement_imports
     set line_count = v_inserted,
         duplicate_count = v_row - v_inserted,
         statement_from = (select min(line_date) from public.bank_statement_lines where import_id = v_import.id),
         statement_to = (select max(line_date) from public.bank_statement_lines where import_id = v_import.id),
         closing_balance = (select l.running_balance from public.bank_statement_lines l where l.import_id = v_import.id
                            order by l.line_date desc, l.row_no desc limit 1)
   where id = v_import.id
   returning * into v_import;
  return v_import;
end;
$$;

-- Posted ledger lines on a bank account that aren't matched to the statement yet.
create or replace view public.unmatched_bank_ledger_lines with (security_invoker = true) as
select l.id, l.bank_account_id, l.branch_id, e.entry_date, e.entry_no, e.id as entry_id, e.description,
       (l.debit - l.credit)::numeric(14, 2) as amount, t.reference as transaction_reference
from public.journal_lines l
join public.journal_entries e on e.id = l.entry_id and e.status = 'posted'
left join public.finance_transactions t on t.id = e.transaction_id
where l.bank_account_id is not null
  and not exists (select 1 from public.bank_match_ledger_lines m where m.journal_line_id = l.id);
grant select on public.unmatched_bank_ledger_lines to authenticated;

-- Matches statement lines to ledger lines. One-to-one, many-to-one and one-to-many are all allowed;
-- the totals must agree.
create or replace function public.match_bank_lines(p_statement_line_ids uuid[], p_journal_line_ids uuid[], p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bank_ids uuid[];
  v_bank public.bank_accounts;
  v_statement_total numeric;
  v_ledger_total numeric;
  v_match_id uuid;
begin
  if coalesce(array_length(p_statement_line_ids, 1), 0) = 0 or coalesce(array_length(p_journal_line_ids, 1), 0) = 0 then
    raise exception 'pick at least one statement line and one ledger line' using errcode = 'check_violation';
  end if;

  select array_agg(distinct s.bank_account_id), sum(s.amount) into v_bank_ids, v_statement_total
  from public.bank_statement_lines s where s.id = any(p_statement_line_ids) and s.status = 'unmatched';
  if (select count(*) from public.bank_statement_lines s where s.id = any(p_statement_line_ids) and s.status = 'unmatched')
     <> array_length(p_statement_line_ids, 1) or array_length(v_bank_ids, 1) <> 1 then
    raise exception 'every statement line must be unmatched and on the same bank account' using errcode = 'check_violation';
  end if;

  select * into v_bank from public.bank_accounts where id = v_bank_ids[1];
  if not app.has_branch_permission('accounts.bank.reconcile', v_bank.branch_id) then
    raise exception 'bank account not found' using errcode = 'no_data_found';
  end if;

  select sum(l.debit - l.credit) into v_ledger_total
  from public.journal_lines l join public.journal_entries e on e.id = l.entry_id and e.status = 'posted'
  where l.id = any(p_journal_line_ids) and l.bank_account_id = v_bank.id
    and not exists (select 1 from public.bank_match_ledger_lines m where m.journal_line_id = l.id);
  if (select count(*) from public.journal_lines l join public.journal_entries e on e.id = l.entry_id and e.status = 'posted'
      where l.id = any(p_journal_line_ids) and l.bank_account_id = v_bank.id
        and not exists (select 1 from public.bank_match_ledger_lines m where m.journal_line_id = l.id))
     <> array_length(p_journal_line_ids, 1) then
    raise exception 'every ledger line must be posted, unmatched and on the same bank account' using errcode = 'check_violation';
  end if;
  if v_statement_total <> v_ledger_total then
    raise exception 'the statement lines total % but the ledger lines total %', v_statement_total, v_ledger_total
      using errcode = 'check_violation';
  end if;

  insert into public.bank_matches (bank_account_id, branch_id, method, note)
  values (v_bank.id, v_bank.branch_id, case when p_note = 'auto' then 'auto' else 'manual' end, nullif(trim(p_note), 'auto'))
  returning id into v_match_id;
  insert into public.bank_match_ledger_lines (match_id, journal_line_id) select v_match_id, unnest(p_journal_line_ids);
  update public.bank_statement_lines set status = 'matched', match_id = v_match_id where id = any(p_statement_line_ids);
  return v_match_id;
end;
$$;

-- Matches safe one-to-one pairs: same amount, dates within three days, and exactly one candidate on each side
-- (a matching reference breaks a tie). Everything else stays in the review queue.
create or replace function public.auto_match_bank_lines(p_bank_account_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bank public.bank_accounts;
  v_line record;
  v_candidates uuid[];
  v_matched integer := 0;
begin
  select * into v_bank from public.bank_accounts where id = p_bank_account_id;
  if not found or not app.has_branch_permission('accounts.bank.reconcile', v_bank.branch_id) then
    raise exception 'bank account not found' using errcode = 'no_data_found';
  end if;

  for v_line in
    select * from public.bank_statement_lines s
    where s.bank_account_id = p_bank_account_id and s.status = 'unmatched'
    order by s.line_date, s.row_no
  loop
    select array_agg(u.id order by u.entry_date) into v_candidates
    from public.unmatched_bank_ledger_lines u
    where u.bank_account_id = p_bank_account_id and u.amount = v_line.amount
      and u.entry_date between v_line.line_date - 3 and v_line.line_date + 3;

    if coalesce(array_length(v_candidates, 1), 0) > 1 and v_line.reference is not null then
      select array_agg(u.id) into v_candidates
      from public.unmatched_bank_ledger_lines u
      where u.id = any(v_candidates) and upper(trim(u.transaction_reference)) = upper(trim(v_line.reference));
    end if;

    if coalesce(array_length(v_candidates, 1), 0) = 1
       -- Skip when another unmatched statement line could claim the same ledger line.
       and not exists (
         select 1 from public.bank_statement_lines o
         where o.bank_account_id = p_bank_account_id and o.status = 'unmatched' and o.id <> v_line.id
           and o.amount = v_line.amount and o.line_date between v_line.line_date - 6 and v_line.line_date + 6
           and (v_line.reference is null or o.reference is not distinct from v_line.reference)
       ) then
      perform public.match_bank_lines(array[v_line.id], v_candidates, 'auto');
      v_matched := v_matched + 1;
    end if;
  end loop;
  return v_matched;
end;
$$;

create or replace function public.unmatch_bank_lines(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_match public.bank_matches;
begin
  select * into v_match from public.bank_matches where id = p_match_id;
  if not found or not app.has_branch_permission('accounts.bank.reconcile', v_match.branch_id) then
    raise exception 'match not found' using errcode = 'no_data_found';
  end if;
  if exists (select 1 from public.bank_reconciliations r where r.bank_account_id = v_match.bank_account_id and r.status = 'completed'
             and r.period_end >= (select min(s.line_date) from public.bank_statement_lines s where s.match_id = p_match_id)) then
    raise exception 'this match is part of a completed reconciliation' using errcode = 'check_violation';
  end if;
  update public.bank_statement_lines set status = 'unmatched', match_id = null where match_id = p_match_id;
  delete from public.bank_matches where id = p_match_id;
end;
$$;

create or replace function public.exclude_bank_statement_line(p_line_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_line public.bank_statement_lines;
begin
  select * into v_line from public.bank_statement_lines where id = p_line_id;
  if not found or not app.has_branch_permission('accounts.bank.reconcile', v_line.branch_id) then
    raise exception 'statement line not found' using errcode = 'no_data_found';
  end if;
  if p_reason is null then
    update public.bank_statement_lines set status = 'unmatched', exclusion_reason = null where id = p_line_id and status = 'excluded';
    return;
  end if;
  if v_line.status <> 'unmatched' then
    raise exception 'only unmatched lines can be set aside' using errcode = 'check_violation';
  end if;
  if length(trim(p_reason)) = 0 then
    raise exception 'say why this line is being set aside' using errcode = 'check_violation';
  end if;
  update public.bank_statement_lines set status = 'excluded', exclusion_reason = trim(p_reason) where id = p_line_id;
end;
$$;

-- Figures for a reconciliation as at a date. Difference is zero when the bank and the books agree once
-- unmatched items on each side are accounted for.
create or replace function app.reconciliation_figures(p_bank_account_id uuid, p_period_end date, p_statement_balance numeric)
returns table (ledger_balance numeric, unmatched_statement_total numeric, unmatched_ledger_total numeric, difference numeric)
language sql
stable
security definer
set search_path = ''
as $$
  with figures as (
    select
      (select coalesce(sum(l.debit - l.credit), 0) from public.journal_lines l
        join public.journal_entries e on e.id = l.entry_id and e.status = 'posted'
        where l.bank_account_id = p_bank_account_id and e.entry_date <= p_period_end) as ledger_balance,
      (select coalesce(sum(s.amount), 0) from public.bank_statement_lines s
        where s.bank_account_id = p_bank_account_id and s.status = 'unmatched' and s.line_date <= p_period_end) as unmatched_statement_total,
      (select coalesce(sum(u.amount), 0) from public.unmatched_bank_ledger_lines u
        where u.bank_account_id = p_bank_account_id and u.entry_date <= p_period_end) as unmatched_ledger_total
  )
  select ledger_balance, unmatched_statement_total, unmatched_ledger_total,
         (p_statement_balance - unmatched_statement_total) - (ledger_balance - unmatched_ledger_total)
  from figures;
$$;

create or replace function public.prepare_bank_reconciliation(
  p_bank_account_id uuid, p_period_end date, p_statement_balance numeric, p_notes text default null
)
returns public.bank_reconciliations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bank public.bank_accounts;
  v_figures record;
  v_rec public.bank_reconciliations;
begin
  select * into v_bank from public.bank_accounts where id = p_bank_account_id;
  if not found or not app.has_branch_permission('accounts.bank.reconcile', v_bank.branch_id) then
    raise exception 'bank account not found' using errcode = 'no_data_found';
  end if;
  if p_period_end > current_date then
    raise exception 'the reconciliation date can''t be in the future' using errcode = 'check_violation';
  end if;
  select * into v_figures from app.reconciliation_figures(p_bank_account_id, p_period_end, p_statement_balance);

  insert into public.bank_reconciliations as r
    (bank_account_id, branch_id, period_end, statement_balance, ledger_balance, unmatched_statement_total, unmatched_ledger_total,
     difference, notes)
  values
    (p_bank_account_id, v_bank.branch_id, p_period_end, p_statement_balance, v_figures.ledger_balance,
     v_figures.unmatched_statement_total, v_figures.unmatched_ledger_total, v_figures.difference, nullif(trim(p_notes), ''))
  on conflict (bank_account_id, period_end) do update
    set statement_balance = excluded.statement_balance, ledger_balance = excluded.ledger_balance,
        unmatched_statement_total = excluded.unmatched_statement_total, unmatched_ledger_total = excluded.unmatched_ledger_total,
        difference = excluded.difference, notes = excluded.notes, prepared_by = auth.uid(), prepared_at = now()
    where r.status = 'draft'
  returning * into v_rec;
  if v_rec.id is null then
    raise exception 'the reconciliation for this date is already completed' using errcode = 'check_violation';
  end if;
  return v_rec;
end;
$$;

create or replace function public.complete_bank_reconciliation(p_id uuid)
returns public.bank_reconciliations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rec public.bank_reconciliations;
  v_figures record;
begin
  select * into v_rec from public.bank_reconciliations where id = p_id for update;
  if not found or not app.has_branch_permission('accounts.transactions.approve', v_rec.branch_id) then
    raise exception 'reconciliation not found' using errcode = 'no_data_found';
  end if;
  if v_rec.status <> 'draft' then
    raise exception 'this reconciliation is already completed' using errcode = 'check_violation';
  end if;
  if v_rec.prepared_by = auth.uid() then
    raise exception 'you prepared this reconciliation, so someone else must review it' using errcode = 'insufficient_privilege';
  end if;
  -- Refresh the figures: matching may have changed since it was prepared.
  select * into v_figures from app.reconciliation_figures(v_rec.bank_account_id, v_rec.period_end, v_rec.statement_balance);
  if v_figures.difference <> 0 and coalesce(length(trim(v_rec.notes)), 0) = 0 then
    raise exception 'the difference is % ; document the reconciling items in the notes before completing', v_figures.difference
      using errcode = 'check_violation';
  end if;
  update public.bank_reconciliations
     set ledger_balance = v_figures.ledger_balance, unmatched_statement_total = v_figures.unmatched_statement_total,
         unmatched_ledger_total = v_figures.unmatched_ledger_total, difference = v_figures.difference,
         status = 'completed', completed_by = auth.uid(), completed_at = now()
   where id = p_id
   returning * into v_rec;
  return v_rec;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reports. security_invoker functions and views: each caller sees only the branches they're allowed to.
-- ---------------------------------------------------------------------------

-- Opening, period and closing figures for every detail account (debit positive, credit negative).
create or replace function public.account_balances(p_from date, p_to date, p_branch_id uuid default null, p_region_id uuid default null)
returns table (
  code text, name text, account_type public.account_type, parent_code text, cash_flow_class text,
  opening numeric, debit numeric, credit numeric, closing numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  select a.code, a.name, a.account_type, a.parent_code, a.cash_flow_class,
    coalesce(sum(x.debit - x.credit) filter (where x.entry_date < p_from), 0)::numeric(16, 2),
    coalesce(sum(x.debit) filter (where x.entry_date between p_from and p_to), 0)::numeric(16, 2),
    coalesce(sum(x.credit) filter (where x.entry_date between p_from and p_to), 0)::numeric(16, 2),
    coalesce(sum(x.debit - x.credit) filter (where x.entry_date <= p_to), 0)::numeric(16, 2)
  from public.ledger_accounts a
  left join (
    select l.account_code, l.debit, l.credit, e.entry_date
    from public.journal_lines l
    join public.journal_entries e on e.id = l.entry_id and e.status = 'posted'
    join public.branches b on b.id = l.branch_id
    where (p_branch_id is null or l.branch_id = p_branch_id)
      and (p_region_id is null or b.region_id = p_region_id)
  ) x on x.account_code = a.code
  where not a.is_group
  group by a.code
  order by a.code;
$$;

-- Direct-method cash flow: cash movements grouped by the account on the other side of each entry.
create or replace function public.cash_flow(p_from date, p_to date, p_branch_id uuid default null, p_region_id uuid default null)
returns table (cash_flow_class text, account_code text, account_name text, amount numeric)
language sql
stable
security invoker
set search_path = ''
as $$
  with lines as (
    select l.entry_id, l.account_code, a.name, a.cash_flow_class, (l.debit - l.credit) as net
    from public.journal_lines l
    join public.journal_entries e on e.id = l.entry_id and e.status = 'posted' and e.entry_date between p_from and p_to
    join public.ledger_accounts a on a.code = l.account_code
    join public.branches b on b.id = l.branch_id
    where (p_branch_id is null or l.branch_id = p_branch_id)
      and (p_region_id is null or b.region_id = p_region_id)
  ),
  cash_entries as (
    select entry_id from lines where cash_flow_class = 'cash' group by entry_id having sum(net) <> 0
  )
  -- In a balanced entry the cash movement equals the opposite of the non-cash lines, so each non-cash line's
  -- credit is cash coming in and its debit is cash going out.
  select x.cash_flow_class, x.account_code, x.name, sum(-x.net)::numeric(16, 2)
  from lines x
  join cash_entries c on c.entry_id = x.entry_id
  where x.cash_flow_class <> 'cash'
  group by x.cash_flow_class, x.account_code, x.name
  order by x.cash_flow_class, x.account_code;
$$;

-- Member subledger: savings, payables, capital and loans per member as at a date.
create or replace function public.member_balances(p_as_at date, p_branch_id uuid default null, p_region_id uuid default null)
returns table (
  member_id uuid, membership_no text, member_name text, branch_id uuid,
  savings numeric, fixed_term numeric, matured_payable numeric, roi_payable numeric, capital numeric,
  loan_principal numeric, interest_paid numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  select m.id, m.membership_no, concat_ws(' ', m.first_name, m.middle_name, m.last_name), m.branch_id,
    coalesce(sum(l.credit - l.debit) filter (where l.account_code = '2110'), 0)::numeric(16, 2),
    coalesce(sum(l.credit - l.debit) filter (where l.account_code = '2120'), 0)::numeric(16, 2),
    coalesce(sum(l.credit - l.debit) filter (where l.account_code = '2130'), 0)::numeric(16, 2),
    coalesce(sum(l.credit - l.debit) filter (where l.account_code = '2140'), 0)::numeric(16, 2),
    coalesce(sum(l.credit - l.debit) filter (where l.account_code = '3100'), 0)::numeric(16, 2),
    coalesce(sum(l.debit - l.credit) filter (where l.account_code in ('1210', '1220')), 0)::numeric(16, 2),
    coalesce(sum(l.credit - l.debit) filter (where l.account_code = '4100'), 0)::numeric(16, 2)
  from public.journal_lines l
  join public.journal_entries e on e.id = l.entry_id and e.status = 'posted' and e.entry_date <= p_as_at
  join public.members m on m.id = l.member_id
  join public.branches b on b.id = m.branch_id
  where (p_branch_id is null or m.branch_id = p_branch_id)
    and (p_region_id is null or b.region_id = p_region_id)
  group by m.id
  order by m.last_name, m.first_name;
$$;

-- Ledger balance and open statement items per bank or cash account.
create or replace view public.bank_account_balances with (security_invoker = true) as
select b.id as bank_account_id, b.branch_id,
       coalesce((select sum(l.debit - l.credit) from public.journal_lines l
                 join public.journal_entries e on e.id = l.entry_id and e.status = 'posted'
                 where l.bank_account_id = b.id), 0)::numeric(16, 2) as ledger_balance,
       (select count(*) from public.bank_statement_lines s where s.bank_account_id = b.id and s.status = 'unmatched') as unmatched_lines,
       (select max(s.line_date) from public.bank_statement_lines s where s.bank_account_id = b.id) as last_statement_date,
       (select max(r.period_end) from public.bank_reconciliations r where r.bank_account_id = b.id and r.status = 'completed')
         as last_reconciled
from public.bank_accounts b;
grant select on public.bank_account_balances to authenticated;

-- Verified Administration contributions that Accounts hasn't posted yet.
create or replace view public.contributions_awaiting_posting with (security_invoker = true) as
select c.id, c.member_id, c.member_plan_id, c.branch_id, c.kind, c.amount, c.paid_on, c.payment_method, c.reference,
       c.verified_at, concat_ws(' ', m.first_name, m.middle_name, m.last_name) as member_name, m.membership_no
from public.contributions c
join public.members m on m.id = c.member_id
where c.verified_at is not null
  and not exists (
    select 1 from public.finance_transactions t where t.contribution_id = c.id and t.status <> 'rejected'
  );
grant select on public.contributions_awaiting_posting to authenticated;

-- ---------------------------------------------------------------------------
-- Audit trail
-- ---------------------------------------------------------------------------

select app.enable_audit('public.ledger_accounts');
select app.enable_audit('public.bank_accounts');
select app.enable_audit('public.posting_rules');
select app.enable_audit('public.journal_entries');
select app.enable_audit('public.journal_lines');
select app.enable_audit('public.finance_transactions');
select app.enable_audit('public.finance_attachments');
select app.enable_audit('public.bank_statement_imports');
select app.enable_audit('public.bank_statement_lines');
select app.enable_audit('public.bank_matches');
select app.enable_audit('public.bank_match_ledger_lines');
select app.enable_audit('public.bank_categorisation_rules');
select app.enable_audit('public.bank_reconciliations');

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.ledger_accounts enable row level security;
alter table public.bank_accounts enable row level security;
alter table public.posting_rules enable row level security;
alter table public.journal_entries enable row level security;
alter table public.journal_lines enable row level security;
alter table public.finance_transactions enable row level security;
alter table public.finance_attachments enable row level security;
alter table public.bank_statement_imports enable row level security;
alter table public.bank_statement_lines enable row level security;
alter table public.bank_matches enable row level security;
alter table public.bank_match_ledger_lines enable row level security;
alter table public.bank_categorisation_rules enable row level security;
alter table public.bank_reconciliations enable row level security;

-- Configuration: readable by finance staff, changed by holders of accounts.config.manage. Never deleted.
create policy "finance staff read the chart of accounts" on public.ledger_accounts for select to authenticated
  using (app.has_permission('accounts.read'));
create policy "finance config managers add accounts" on public.ledger_accounts for insert to authenticated
  with check (app.has_permission('accounts.config.manage'));
create policy "finance config managers edit accounts" on public.ledger_accounts for update to authenticated
  using (app.has_permission('accounts.config.manage')) with check (app.has_permission('accounts.config.manage'));

create policy "finance staff read posting rules" on public.posting_rules for select to authenticated
  using (app.has_permission('accounts.read'));
create policy "finance config managers edit posting rules" on public.posting_rules for update to authenticated
  using (app.has_permission('accounts.config.manage')) with check (app.has_permission('accounts.config.manage'));

create policy "finance staff read categorisation rules" on public.bank_categorisation_rules for select to authenticated
  using (app.has_permission('accounts.read'));
create policy "reconcilers add categorisation rules" on public.bank_categorisation_rules for insert to authenticated
  with check (app.has_permission('accounts.bank.reconcile'));

create policy "finance staff read their branches' bank accounts" on public.bank_accounts for select to authenticated
  using (app.has_branch_permission('accounts.read', branch_id));
create policy "finance config managers add bank accounts" on public.bank_accounts for insert to authenticated
  with check (app.has_branch_permission('accounts.config.manage', branch_id));
create policy "finance config managers edit bank accounts" on public.bank_accounts for update to authenticated
  using (app.has_branch_permission('accounts.config.manage', branch_id))
  with check (app.has_branch_permission('accounts.config.manage', branch_id));

-- Receipts and payments. Drafts are edited only by the person who started them.
create policy "finance staff read their branches' transactions" on public.finance_transactions for select to authenticated
  using (app.has_branch_permission('accounts.read', branch_id));
create policy "finance staff start receipts and payment requests" on public.finance_transactions for insert to authenticated
  with check (
    app.has_branch_permission(
      case when direction = 'receipt' then 'accounts.receipts.record' else 'accounts.payments.request' end, branch_id
    )
  );
create policy "owners edit their draft transactions" on public.finance_transactions for update to authenticated
  using (status in ('draft', 'returned') and created_by = auth.uid())
  with check (
    created_by = auth.uid()
    and app.has_branch_permission(
      case when direction = 'receipt' then 'accounts.receipts.record' else 'accounts.payments.request' end, branch_id
    )
  );

create policy "finance staff read attachments" on public.finance_attachments for select to authenticated
  using (app.has_branch_permission('accounts.read', branch_id));
create policy "finance staff attach evidence" on public.finance_attachments for insert to authenticated
  with check (
    case when kind = 'payment_proof'
      then app.has_branch_permission('accounts.payments.pay', branch_id)
      else app.has_branch_permission('accounts.receipts.record', branch_id)
        or app.has_branch_permission('accounts.payments.request', branch_id)
    end
  );

-- Journals. Lines follow their entry.
create policy "finance staff read journals" on public.journal_entries for select to authenticated
  using (app.has_branch_permission('accounts.read', branch_id));
create policy "preparers start journals" on public.journal_entries for insert to authenticated
  with check (app.has_branch_permission('accounts.journals.prepare', branch_id));
create policy "preparers edit their draft journals" on public.journal_entries for update to authenticated
  using (status = 'draft' and created_by = auth.uid())
  with check (created_by = auth.uid() and app.has_branch_permission('accounts.journals.prepare', branch_id));
create policy "preparers delete their draft journals" on public.journal_entries for delete to authenticated
  using (status = 'draft' and created_by = auth.uid());

create policy "finance staff read journal lines" on public.journal_lines for select to authenticated
  using (app.has_branch_permission('accounts.read', branch_id));
create policy "preparers write lines on their drafts" on public.journal_lines for all to authenticated
  using (exists (select 1 from public.journal_entries e where e.id = entry_id and e.status = 'draft' and e.created_by = auth.uid()))
  with check (
    exists (select 1 from public.journal_entries e where e.id = entry_id and e.status = 'draft' and e.created_by = auth.uid())
    and app.has_branch_permission('accounts.journals.prepare', branch_id)
  );

-- Bank statements and reconciliations: read here, written only through the functions above.
create policy "finance staff read statement imports" on public.bank_statement_imports for select to authenticated
  using (app.has_branch_permission('accounts.read', branch_id));
create policy "finance staff read statement lines" on public.bank_statement_lines for select to authenticated
  using (app.has_branch_permission('accounts.read', branch_id));
create policy "finance staff read matches" on public.bank_matches for select to authenticated
  using (app.has_branch_permission('accounts.read', branch_id));
create policy "finance staff read matched ledger lines" on public.bank_match_ledger_lines for select to authenticated
  using (exists (select 1 from public.bank_matches m where m.id = match_id));
create policy "finance staff read reconciliations" on public.bank_reconciliations for select to authenticated
  using (app.has_branch_permission('accounts.read', branch_id));

-- ---------------------------------------------------------------------------
-- Function grants
-- ---------------------------------------------------------------------------

revoke all on function public.submit_finance_transaction(uuid) from public, anon;
revoke all on function public.approve_finance_transaction(uuid) from public, anon;
revoke all on function public.decline_finance_transaction(uuid, text, text) from public, anon;
revoke all on function public.pay_finance_transaction(uuid) from public, anon;
revoke all on function public.post_journal_entry(uuid) from public, anon;
revoke all on function public.reverse_journal_entry(uuid, text, date) from public, anon;
revoke all on function public.save_bank_import_mapping(uuid, jsonb) from public, anon;
revoke all on function public.import_bank_statement(uuid, text, text, text, jsonb) from public, anon;
revoke all on function public.match_bank_lines(uuid[], uuid[], text) from public, anon;
revoke all on function public.auto_match_bank_lines(uuid) from public, anon;
revoke all on function public.unmatch_bank_lines(uuid) from public, anon;
revoke all on function public.exclude_bank_statement_line(uuid, text) from public, anon;
revoke all on function public.prepare_bank_reconciliation(uuid, date, numeric, text) from public, anon;
revoke all on function public.complete_bank_reconciliation(uuid) from public, anon;
revoke all on function public.account_balances(date, date, uuid, uuid) from public, anon;
revoke all on function public.cash_flow(date, date, uuid, uuid) from public, anon;
revoke all on function public.member_balances(date, uuid, uuid) from public, anon;
revoke all on function app.reconciliation_figures(uuid, date, numeric) from public, anon, authenticated;
revoke all on function app.assert_balanced(uuid) from public, anon, authenticated;

grant execute on function public.submit_finance_transaction(uuid) to authenticated;
grant execute on function public.approve_finance_transaction(uuid) to authenticated;
grant execute on function public.decline_finance_transaction(uuid, text, text) to authenticated;
grant execute on function public.pay_finance_transaction(uuid) to authenticated;
grant execute on function public.post_journal_entry(uuid) to authenticated;
grant execute on function public.reverse_journal_entry(uuid, text, date) to authenticated;
grant execute on function public.save_bank_import_mapping(uuid, jsonb) to authenticated;
grant execute on function public.import_bank_statement(uuid, text, text, text, jsonb) to authenticated;
grant execute on function public.match_bank_lines(uuid[], uuid[], text) to authenticated;
grant execute on function public.auto_match_bank_lines(uuid) to authenticated;
grant execute on function public.unmatch_bank_lines(uuid) to authenticated;
grant execute on function public.exclude_bank_statement_line(uuid, text) to authenticated;
grant execute on function public.prepare_bank_reconciliation(uuid, date, numeric, text) to authenticated;
grant execute on function public.complete_bank_reconciliation(uuid) to authenticated;
grant execute on function public.account_balances(date, date, uuid, uuid) to authenticated;
grant execute on function public.cash_flow(date, date, uuid, uuid) to authenticated;
grant execute on function public.member_balances(date, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Private storage for receipts, invoices, proof of payment and bank statement files.
-- Files are stored at <branch_id>/<transaction or "statements">/<file>, so access follows the branch.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('finance-evidence', 'finance-evidence', false, 10485760,
        array['application/pdf', 'image/jpeg', 'image/png', 'text/csv', 'text/plain', 'application/vnd.ms-excel'])
on conflict (id) do nothing;

create policy "finance staff download finance evidence" on storage.objects for select to authenticated
  using (bucket_id = 'finance-evidence' and app.has_branch_permission('accounts.read', app.storage_path_branch(name)));

create policy "finance staff upload finance evidence" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'finance-evidence' and (
      app.has_branch_permission('accounts.receipts.record', app.storage_path_branch(name))
      or app.has_branch_permission('accounts.payments.request', app.storage_path_branch(name))
      or app.has_branch_permission('accounts.payments.pay', app.storage_path_branch(name))
      or app.has_branch_permission('accounts.bank.reconcile', app.storage_path_branch(name))
    )
  );
-- No update or delete policies: evidence is kept.
