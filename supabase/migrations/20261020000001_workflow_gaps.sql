-- Closes the workflow gaps that need no input from Kuun or another department:
--   Administration: expected vs paid per plan, issued letters and statements, the Branch Manager's signature on approval,
--                   monthly branch targets.
--   Accounts:       department, product, staff, supplier and currency on transactions and ledger lines; suppliers and
--                   supplier bills; posting rule changes approved by a second person; bank suggestions that learn
--                   from earlier postings.

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------

insert into public.permissions (code, description) values
  ('targets.manage', 'Set monthly registration and collection targets for branches'),
  ('accounts.config.propose', 'Propose a change to a posting rule for someone else to approve'),
  ('accounts.suppliers.manage', 'Add and edit suppliers');

insert into public.role_permissions (role_code, permission_code) values
  ('head_of_administration', 'targets.manage'),
  ('regional_accountant', 'accounts.config.propose'),
  ('regional_accountant', 'accounts.suppliers.manage'),
  ('payments_accountant', 'accounts.suppliers.manage'),
  ('financial_controller', 'accounts.config.propose'),
  ('financial_controller', 'accounts.suppliers.manage');

-- ===========================================================================
-- Administration
-- ===========================================================================

-- Contributions a plan should have received by a date: one per period from the start date, up to maturity.
create or replace function app.installments_due(p_frequency text, p_start date, p_maturity date, p_as_at date)
returns integer
language sql
immutable
set search_path = ''
as $$
  with span as (select least(p_as_at, p_maturity) as until, age(least(p_as_at, p_maturity), p_start) as gap)
  select case
    when p_as_at < p_start then 0
    when p_frequency = 'one_off' then 1
    when p_frequency = 'weekly' then ((select until from span) - p_start) / 7 + 1
    when p_frequency = 'monthly' then
      (extract(year from (select gap from span)) * 12 + extract(month from (select gap from span)))::integer + 1
    when p_frequency = 'quarterly' then
      ((extract(year from (select gap from span)) * 12 + extract(month from (select gap from span)))::integer / 3) + 1
    else 0
  end;
$$;

-- Each plan's expected contributions to date against what was recorded, verified and still outstanding.
-- Reversals reduce whichever kind of payment they reverse.
create or replace view public.plan_progress with (security_invoker = true) as
select
  p.id as plan_id, p.member_id, p.branch_id, p.plan_type, p.contribution_amount, p.contribution_frequency,
  p.start_date, p.maturity_date, p.status,
  concat_ws(' ', m.first_name, m.middle_name, m.last_name) as member_name, m.membership_no,
  app.installments_due(p.contribution_frequency, p.start_date, p.maturity_date, current_date) as installments_due,
  (app.installments_due(p.contribution_frequency, p.start_date, p.maturity_date, current_date) * p.contribution_amount)::numeric(16, 2)
    as expected_to_date,
  coalesce(c.scheduled, 0)::numeric(16, 2) as scheduled_paid,
  coalesce(c.top_ups, 0)::numeric(16, 2) as top_ups,
  coalesce(c.total, 0)::numeric(16, 2) as total_contributed,
  coalesce(c.verified, 0)::numeric(16, 2) as total_verified,
  greatest(
    app.installments_due(p.contribution_frequency, p.start_date, p.maturity_date, current_date) * p.contribution_amount
      - coalesce(c.scheduled, 0),
    0
  )::numeric(16, 2) as outstanding,
  c.last_paid_on,
  (p.maturity_date - current_date) as days_to_maturity
from public.member_plans p
join public.members m on m.id = p.member_id
left join lateral (
  select
    sum(x.amount) as total,
    sum(x.amount) filter (where coalesce(r.kind, x.kind) = 'scheduled') as scheduled,
    sum(x.amount) filter (where coalesce(r.kind, x.kind) = 'top_up') as top_ups,
    sum(x.amount) filter (where x.verified_at is not null) as verified,
    max(x.paid_on) filter (where x.kind <> 'reversal') as last_paid_on
  from public.contributions x
  left join public.contributions r on r.id = x.reverses_id
  where x.member_plan_id = p.id
) c on true;

grant select on public.plan_progress to authenticated;

-- ---------------------------------------------------------------------------
-- Issued letters and statements
-- ---------------------------------------------------------------------------

alter type public.member_document_type add value if not exists 'statement_of_account';
alter type public.member_document_type add value if not exists 'maturity_letter';

alter table public.member_documents
  add column issued_on date,
  add column issued_by uuid references public.staff (id),
  add column issued_at timestamptz,
  add column issue_channel text check (issue_channel in ('email', 'in_person', 'courier', 'whatsapp')),
  add column issue_note text;

-- Records that a signed agreement letter, statement of account or maturity letter was sent to the member. Once only.
create or replace function public.record_document_issue(p_document_id uuid, p_issued_on date, p_channel text, p_note text default null)
returns public.member_documents
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doc public.member_documents;
  v_member public.members;
begin
  select * into v_doc from public.member_documents where id = p_document_id for update;
  if not found or not app.has_branch_permission('members.manage', v_doc.branch_id) then
    raise exception 'document not found' using errcode = 'no_data_found';
  end if;
  if v_doc.document_type::text not in ('signed_agreement_letter', 'statement_of_account', 'maturity_letter') then
    raise exception 'only agreement letters, statements of account and maturity letters are issued' using errcode = 'check_violation';
  end if;
  if v_doc.issued_at is not null then
    raise exception 'this document was already issued on %', v_doc.issued_on using errcode = 'check_violation';
  end if;
  select * into v_member from public.members where id = v_doc.member_id;
  if v_member.status <> 'approved' then
    raise exception 'documents are issued to approved members only' using errcode = 'check_violation';
  end if;
  if p_issued_on is null or p_issued_on > current_date then
    raise exception 'the issue date can''t be in the future' using errcode = 'check_violation';
  end if;
  if p_channel is null or p_channel not in ('email', 'in_person', 'courier', 'whatsapp') then
    raise exception 'choose how the document was sent' using errcode = 'check_violation';
  end if;

  update public.member_documents
     set issued_on = p_issued_on, issued_by = auth.uid(), issued_at = now(), issue_channel = p_channel,
         issue_note = nullif(trim(p_note), '')
   where id = p_document_id
   returning * into v_doc;
  return v_doc;
end;
$$;

-- ---------------------------------------------------------------------------
-- The Branch Manager's signature on approval
-- ---------------------------------------------------------------------------

alter table public.members add column approval_signature text;

create or replace function app.members_signature_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if app.in_workflow() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.approval_signature := null;
  elsif new.approval_signature is distinct from old.approval_signature then
    raise exception 'the approval signature is recorded only when the Branch Manager approves' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger members_signature_guard
  before insert or update on public.members
  for each row execute function app.members_signature_guard();

drop function public.approve_member(uuid);

create or replace function public.approve_member(p_member_id uuid, p_signature text)
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
  if p_signature is null or p_signature !~ '^data:image/png;base64,[A-Za-z0-9+/]+=*$' or length(p_signature) > 200000 then
    raise exception 'sign in the box before approving' using errcode = 'check_violation';
  end if;

  select code into v_branch_code from public.branches where id = v_member.branch_id;

  perform app.begin_workflow();
  update public.members
     set status = 'approved',
         approved_by = auth.uid(),
         approved_at = now(),
         approval_signature = p_signature,
         membership_no = 'KUN-' || v_branch_code || '-' || lpad(nextval('public.membership_number_seq')::text, 6, '0')
   where id = p_member_id
   returning * into v_member;
  perform app.end_workflow();
  return v_member;
end;
$$;

revoke all on function public.approve_member(uuid, text) from public, anon;
grant execute on function public.approve_member(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Monthly branch targets
-- ---------------------------------------------------------------------------

create table public.branch_targets (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches (id) on delete restrict,
  month date not null check (extract(day from month) = 1),
  registrations integer not null default 0 check (registrations >= 0),
  collections numeric(14, 2) not null default 0 check (collections >= 0),
  set_by uuid not null default auth.uid() references public.staff (id),
  set_at timestamptz not null default now(),
  constraint branch_targets_once unique (branch_id, month)
);

create or replace function app.branch_targets_stamp()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.set_by := auth.uid();
  new.set_at := now();
  return new;
end;
$$;

create trigger branch_targets_stamp
  before insert or update on public.branch_targets
  for each row execute function app.branch_targets_stamp();

select app.enable_audit('public.branch_targets');
alter table public.branch_targets enable row level security;

create policy "branch staff and auditors read targets" on public.branch_targets for select to authenticated
  using (
    app.has_branch_permission('members.read', branch_id)
    or app.has_branch_permission('accounts.read', branch_id)
    or app.has_permission('module.internal_audit')
  );
create policy "target setters add targets" on public.branch_targets for insert to authenticated
  with check (app.has_branch_permission('targets.manage', branch_id));
create policy "target setters change targets" on public.branch_targets for update to authenticated
  using (app.has_branch_permission('targets.manage', branch_id))
  with check (app.has_branch_permission('targets.manage', branch_id));

-- ===========================================================================
-- Accounts
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Suppliers
-- ---------------------------------------------------------------------------

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  contact_person text,
  phone text,
  email text,
  address text,
  bank_name text,
  account_number text,
  tax_id text,
  is_active boolean not null default true,
  created_by uuid not null default auth.uid() references public.staff (id),
  created_at timestamptz not null default now()
);
create unique index suppliers_name_idx on public.suppliers (lower(trim(name)));

select app.enable_audit('public.suppliers');
alter table public.suppliers enable row level security;

create policy "finance staff read suppliers" on public.suppliers for select to authenticated
  using (app.has_permission('accounts.read'));
create policy "supplier managers add suppliers" on public.suppliers for insert to authenticated
  with check (app.has_permission('accounts.suppliers.manage') and created_by = auth.uid());
create policy "supplier managers edit suppliers" on public.suppliers for update to authenticated
  using (app.has_permission('accounts.suppliers.manage'))
  with check (app.has_permission('accounts.suppliers.manage'));

-- ---------------------------------------------------------------------------
-- Supplier bills: Dr expense (or asset), Cr supplier payables once someone else approves
-- ---------------------------------------------------------------------------

create type public.bill_status as enum ('draft', 'submitted', 'returned', 'rejected', 'posted');
create sequence public.supplier_bill_seq;

create table public.supplier_bills (
  id uuid primary key default gen_random_uuid(),
  bill_no text not null unique,
  supplier_id uuid not null references public.suppliers (id),
  branch_id uuid not null references public.branches (id) on delete restrict,
  department_code text references public.departments (code),
  bill_date date not null,
  due_date date not null,
  supplier_reference text not null check (length(trim(supplier_reference)) > 0),
  expense_account text not null references public.ledger_accounts (code),
  amount numeric(14, 2) not null check (amount > 0),
  description text not null check (length(trim(description)) > 0),
  status public.bill_status not null default 'draft',
  decision_reason text,
  journal_entry_id uuid references public.journal_entries (id),
  created_by uuid not null default auth.uid() references public.staff (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  submitted_by uuid references public.staff (id),
  submitted_at timestamptz,
  approved_by uuid references public.staff (id),
  approved_at timestamptz,
  constraint supplier_bills_due check (due_date >= bill_date)
);
create index supplier_bills_branch_status_idx on public.supplier_bills (branch_id, status);
create index supplier_bills_supplier_idx on public.supplier_bills (supplier_id);
-- A supplier's invoice number is entered once (rejected bills don't count).
create unique index supplier_bills_reference_idx on public.supplier_bills (supplier_id, lower(trim(supplier_reference)))
  where status <> 'rejected';

alter table public.journal_entries add column bill_id uuid references public.supplier_bills (id);
alter table public.journal_entries drop constraint journal_entries_source_check;
alter table public.journal_entries
  add constraint journal_entries_source_check check (source in ('manual', 'transaction', 'reversal', 'bill'));

create or replace function app.supplier_bills_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account public.ledger_accounts;
begin
  if tg_op = 'UPDATE' and app.in_workflow() then
    new.updated_at := now();
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if old.status not in ('draft', 'returned') then
      raise exception 'this bill is % and can''t be edited', old.status using errcode = 'check_violation';
    end if;
    if new.status is distinct from old.status
       or new.bill_no is distinct from old.bill_no
       or new.decision_reason is distinct from old.decision_reason
       or new.journal_entry_id is distinct from old.journal_entry_id
       or new.created_by is distinct from old.created_by
       or new.created_at is distinct from old.created_at
       or new.submitted_by is distinct from old.submitted_by
       or new.submitted_at is distinct from old.submitted_at
       or new.approved_by is distinct from old.approved_by
       or new.approved_at is distinct from old.approved_at then
      raise exception 'status and approval details change only through the approval workflow' using errcode = 'insufficient_privilege';
    end if;
  else
    new.bill_no := 'BILL-' || lpad(nextval('public.supplier_bill_seq')::text, 6, '0');
    new.status := 'draft';
    new.created_by := auth.uid();
    new.created_at := now();
    new.decision_reason := null;
    new.journal_entry_id := null;
    new.submitted_by := null;
    new.submitted_at := null;
    new.approved_by := null;
    new.approved_at := null;
  end if;
  new.updated_at := now();

  if new.bill_date > current_date then
    raise exception 'the bill date can''t be in the future' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.suppliers s where s.id = new.supplier_id and s.is_active) then
    raise exception 'choose an active supplier' using errcode = 'check_violation';
  end if;
  select * into v_account from public.ledger_accounts where code = new.expense_account;
  if v_account.is_group or not v_account.is_active or v_account.account_type not in ('expense', 'asset') then
    raise exception 'a bill is charged to an active expense or asset account' using errcode = 'check_violation';
  end if;
  if new.department_code is not null and not exists (select 1 from public.departments d where d.code = new.department_code and d.is_active) then
    raise exception 'that department isn''t in use' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger supplier_bills_guard
  before insert or update on public.supplier_bills
  for each row execute function app.supplier_bills_guard();

select app.enable_audit('public.supplier_bills');
alter table public.supplier_bills enable row level security;

create policy "finance staff read their branches' bills" on public.supplier_bills for select to authenticated
  using (app.has_branch_permission('accounts.read', branch_id));
create policy "payment requesters record bills" on public.supplier_bills for insert to authenticated
  with check (app.has_branch_permission('accounts.payments.request', branch_id));
create policy "owners edit their draft bills" on public.supplier_bills for update to authenticated
  using (status in ('draft', 'returned') and created_by = auth.uid())
  with check (created_by = auth.uid() and app.has_branch_permission('accounts.payments.request', branch_id));

-- Evidence can belong to a bill as well as to a receipt or payment.
alter table public.finance_attachments alter column transaction_id drop not null;
alter table public.finance_attachments add column supplier_bill_id uuid references public.supplier_bills (id) on delete restrict;
alter table public.finance_attachments
  add constraint finance_attachments_owner check (num_nonnulls(transaction_id, supplier_bill_id) = 1);
create index finance_attachments_bill_idx on public.finance_attachments (supplier_bill_id) where supplier_bill_id is not null;

create or replace function app.finance_attachments_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_txn public.finance_transactions;
  v_bill public.supplier_bills;
begin
  new.uploaded_by := auth.uid();
  new.uploaded_at := now();

  if new.supplier_bill_id is not null then
    select * into v_bill from public.supplier_bills where id = new.supplier_bill_id;
    new.branch_id := v_bill.branch_id;
    if new.kind <> 'supporting' then
      raise exception 'attach the supplier''s invoice to a bill; proof of payment goes on the payment' using errcode = 'check_violation';
    end if;
    if v_bill.status not in ('draft', 'returned') then
      raise exception 'invoices are added while the bill is a draft or returned' using errcode = 'check_violation';
    end if;
    if new.storage_path not like v_bill.branch_id::text || '/bills/' || v_bill.id::text || '/%' then
      raise exception 'storage path must sit under the bill''s folder' using errcode = 'check_violation';
    end if;
    return new;
  end if;

  select * into v_txn from public.finance_transactions where id = new.transaction_id;
  new.branch_id := v_txn.branch_id;
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

create or replace function public.submit_supplier_bill(p_id uuid)
returns public.supplier_bills
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bill public.supplier_bills;
begin
  select * into v_bill from public.supplier_bills where id = p_id for update;
  if not found or not app.has_branch_permission('accounts.payments.request', v_bill.branch_id) then
    raise exception 'bill not found' using errcode = 'no_data_found';
  end if;
  if v_bill.created_by <> auth.uid() then
    raise exception 'only the person who recorded the bill can submit it' using errcode = 'insufficient_privilege';
  end if;
  if v_bill.status not in ('draft', 'returned') then
    raise exception 'only draft or returned bills can be submitted' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.finance_attachments a where a.supplier_bill_id = p_id) then
    raise exception 'attach the supplier''s invoice first' using errcode = 'check_violation';
  end if;

  perform app.begin_workflow();
  update public.supplier_bills
     set status = 'submitted', submitted_by = auth.uid(), submitted_at = now(), decision_reason = null
   where id = p_id
   returning * into v_bill;
  perform app.end_workflow();
  return v_bill;
end;
$$;

-- Approving a bill posts it: Dr the expense or asset account, Cr supplier payables (2210), tagged with the supplier.
create or replace function public.approve_supplier_bill(p_id uuid)
returns public.supplier_bills
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bill public.supplier_bills;
  v_supplier public.suppliers;
  v_entry_id uuid;
begin
  select * into v_bill from public.supplier_bills where id = p_id for update;
  if not found or not app.has_branch_permission('accounts.transactions.approve', v_bill.branch_id) then
    raise exception 'bill not found' using errcode = 'no_data_found';
  end if;
  if v_bill.status <> 'submitted' then
    raise exception 'only submitted bills can be approved' using errcode = 'check_violation';
  end if;
  if auth.uid() in (v_bill.created_by, v_bill.submitted_by) then
    raise exception 'you recorded this bill, so someone else must approve it' using errcode = 'insufficient_privilege';
  end if;
  select * into v_supplier from public.suppliers where id = v_bill.supplier_id;

  perform app.begin_workflow();
  insert into public.journal_entries (branch_id, entry_date, description, source, bill_id, status, created_by, posted_by, posted_at)
  values (v_bill.branch_id, v_bill.bill_date, v_bill.bill_no || ' ' || v_supplier.name || ' invoice ' || v_bill.supplier_reference,
          'bill', v_bill.id, 'draft', v_bill.created_by, auth.uid(), now())
  returning id into v_entry_id;
  insert into public.journal_lines (entry_id, line_no, account_code, debit, department_code, supplier_id, description)
  values (v_entry_id, 1, v_bill.expense_account, v_bill.amount, v_bill.department_code, v_bill.supplier_id, v_bill.description);
  insert into public.journal_lines (entry_id, line_no, account_code, credit, department_code, supplier_id, description)
  values (v_entry_id, 2, '2210', v_bill.amount, v_bill.department_code, v_bill.supplier_id, v_bill.description);
  perform app.assert_balanced(v_entry_id);
  update public.journal_entries set status = 'posted' where id = v_entry_id;

  update public.supplier_bills
     set status = 'posted', approved_by = auth.uid(), approved_at = now(), journal_entry_id = v_entry_id, decision_reason = null
   where id = p_id
   returning * into v_bill;
  perform app.end_workflow();
  return v_bill;
end;
$$;

create or replace function public.decline_supplier_bill(p_id uuid, p_outcome text, p_reason text)
returns public.supplier_bills
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bill public.supplier_bills;
begin
  select * into v_bill from public.supplier_bills where id = p_id for update;
  if not found or not app.has_branch_permission('accounts.transactions.approve', v_bill.branch_id) then
    raise exception 'bill not found' using errcode = 'no_data_found';
  end if;
  if p_outcome not in ('returned', 'rejected') then
    raise exception 'choose to return or reject' using errcode = 'check_violation';
  end if;
  if v_bill.status <> 'submitted' then
    raise exception 'only submitted bills can be returned or rejected' using errcode = 'check_violation';
  end if;
  if auth.uid() in (v_bill.created_by, v_bill.submitted_by) then
    raise exception 'you recorded this bill, so someone else must review it' using errcode = 'insufficient_privilege';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'give a reason' using errcode = 'check_violation';
  end if;

  perform app.begin_workflow();
  update public.supplier_bills
     set status = p_outcome::public.bill_status, decision_reason = trim(p_reason)
   where id = p_id
   returning * into v_bill;
  perform app.end_workflow();
  return v_bill;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reporting dimensions on receipts, payments and ledger lines
-- ---------------------------------------------------------------------------

alter table public.finance_transactions
  add column department_code text references public.departments (code),
  add column plan_type text references public.plan_types (code),
  add column staff_id uuid references public.staff (id),
  add column supplier_id uuid references public.suppliers (id),
  add column supplier_bill_id uuid references public.supplier_bills (id),
  add column currency text not null default 'NGN' check (currency ~ '^[A-Z]{3}$'),
  add column foreign_amount numeric(14, 2) check (foreign_amount > 0),
  add column fx_rate numeric(14, 6) check (fx_rate > 0);
create index finance_transactions_bill_idx on public.finance_transactions (supplier_bill_id) where supplier_bill_id is not null;

alter table public.journal_lines
  add column department_code text references public.departments (code),
  add column plan_type text references public.plan_types (code),
  add column staff_id uuid references public.staff (id),
  add column supplier_id uuid references public.suppliers (id);
create index journal_lines_department_idx on public.journal_lines (department_code) where department_code is not null;
create index journal_lines_supplier_idx on public.journal_lines (supplier_id) where supplier_id is not null;

-- Runs after finance_transactions_guard (trigger names fire in alphabetical order).
create or replace function app.finance_transactions_dimensions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bill public.supplier_bills;
  v_committed numeric;
begin
  if tg_op = 'UPDATE' and app.in_workflow() then
    return new;
  end if;

  -- The ledger is kept in naira. A foreign currency payment records what was paid and the rate used.
  if new.currency = 'NGN' then
    new.foreign_amount := null;
    new.fx_rate := null;
  elsif new.foreign_amount is null or new.fx_rate is null then
    raise exception 'give the % amount and the exchange rate', new.currency using errcode = 'check_violation';
  elsif new.amount <> round(new.foreign_amount * new.fx_rate, 2) then
    raise exception 'the naira amount must equal the % amount times the rate', new.currency using errcode = 'check_violation';
  end if;

  if new.department_code is not null and not exists (select 1 from public.departments d where d.code = new.department_code and d.is_active) then
    raise exception 'that department isn''t in use' using errcode = 'check_violation';
  end if;

  if new.supplier_bill_id is not null then
    select * into v_bill from public.supplier_bills where id = new.supplier_bill_id;
    if new.transaction_type <> 'supplier_payment' then
      raise exception 'only a supplier payment can settle a bill' using errcode = 'check_violation';
    end if;
    if v_bill.status <> 'posted' then
      raise exception 'that bill hasn''t been approved yet' using errcode = 'check_violation';
    end if;
    if v_bill.branch_id <> new.branch_id then
      raise exception 'pay a bill from a bank account in the same branch' using errcode = 'check_violation';
    end if;
    new.supplier_id := v_bill.supplier_id;
    new.department_code := coalesce(new.department_code, v_bill.department_code);
    select coalesce(sum(t.amount), 0) into v_committed from public.finance_transactions t
    where t.supplier_bill_id = v_bill.id and t.id <> new.id and t.status not in ('rejected', 'reversed');
    if new.amount > v_bill.amount - v_committed then
      raise exception 'that is more than the % still owed on %', v_bill.amount - v_committed, v_bill.bill_no using errcode = 'check_violation';
    end if;
  end if;

  if new.transaction_type = 'supplier_payment' and new.supplier_id is null then
    raise exception 'choose the supplier being paid' using errcode = 'check_violation';
  end if;
  if new.supplier_id is not null and new.counterparty is null then
    select s.name into new.counterparty from public.suppliers s where s.id = new.supplier_id;
  end if;
  return new;
end;
$$;

create trigger finance_transactions_guard_dimensions
  before insert or update on public.finance_transactions
  for each row execute function app.finance_transactions_dimensions();

-- Ledger lines inherit the dimensions of what they were posted from. Runs after journal_lines_guard.
create or replace function app.journal_lines_dimensions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry public.journal_entries;
  v_txn public.finance_transactions;
  v_original public.journal_lines;
begin
  select * into v_entry from public.journal_entries where id = new.entry_id;
  if v_entry.transaction_id is not null then
    select * into v_txn from public.finance_transactions where id = v_entry.transaction_id;
    new.department_code := coalesce(new.department_code, v_txn.department_code);
    new.plan_type := coalesce(new.plan_type, v_txn.plan_type);
    new.staff_id := coalesce(new.staff_id, v_txn.staff_id);
    new.supplier_id := coalesce(new.supplier_id, v_txn.supplier_id);
  elsif v_entry.reverses_entry_id is not null then
    select * into v_original from public.journal_lines
    where entry_id = v_entry.reverses_entry_id and line_no = new.line_no and account_code = new.account_code
    limit 1;
    new.department_code := coalesce(new.department_code, v_original.department_code);
    new.plan_type := coalesce(new.plan_type, v_original.plan_type);
    new.staff_id := coalesce(new.staff_id, v_original.staff_id);
    new.supplier_id := coalesce(new.supplier_id, v_original.supplier_id);
  end if;
  return new;
end;
$$;

create trigger journal_lines_guard_dimensions
  before insert on public.journal_lines
  for each row execute function app.journal_lines_dimensions();

-- Staff names and departments for tagging a payment to a person (salaries, allowances, staff advances).
create or replace function public.staff_options()
returns table (id uuid, full_name text, department_code text)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.full_name, s.department_code
  from public.staff s
  where s.is_active and app.has_permission('accounts.read')
  order by s.full_name;
$$;

-- What is still owed on each approved bill.
create or replace view public.supplier_bill_balances with (security_invoker = true) as
select b.id, b.bill_no, b.supplier_id, s.name as supplier_name, b.branch_id, b.department_code, b.bill_date, b.due_date,
       b.supplier_reference, b.expense_account, b.amount, b.status, b.description,
       coalesce(p.paid, 0)::numeric(16, 2) as paid,
       (b.amount - coalesce(p.paid, 0))::numeric(16, 2) as outstanding
from public.supplier_bills b
join public.suppliers s on s.id = b.supplier_id
left join lateral (
  select sum(t.amount) as paid from public.finance_transactions t where t.supplier_bill_id = b.id and t.status = 'posted'
) p on true;

grant select on public.supplier_bill_balances to authenticated;

-- ---------------------------------------------------------------------------
-- Reports by department and product
-- ---------------------------------------------------------------------------

drop function public.account_balances(date, date, uuid, uuid);
drop function public.cash_flow(date, date, uuid, uuid);

create or replace function public.account_balances(
  p_from date, p_to date, p_branch_id uuid default null, p_region_id uuid default null,
  p_department text default null, p_plan_type text default null
)
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
      and (p_department is null or l.department_code = p_department)
      and (p_plan_type is null or l.plan_type = p_plan_type)
  ) x on x.account_code = a.code
  where not a.is_group
  group by a.code
  order by a.code;
$$;

create or replace function public.cash_flow(
  p_from date, p_to date, p_branch_id uuid default null, p_region_id uuid default null,
  p_department text default null, p_plan_type text default null
)
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
      and (p_department is null or l.department_code = p_department)
      and (p_plan_type is null or l.plan_type = p_plan_type)
  ),
  cash_entries as (
    select entry_id from lines where cash_flow_class = 'cash' group by entry_id having sum(net) <> 0
  )
  select x.cash_flow_class, x.account_code, x.name, sum(-x.net)::numeric(16, 2)
  from lines x
  join cash_entries c on c.entry_id = x.entry_id
  where x.cash_flow_class <> 'cash'
  group by x.cash_flow_class, x.account_code, x.name
  order by x.cash_flow_class, x.account_code;
$$;

-- ---------------------------------------------------------------------------
-- Posting rule changes need a second person
-- ---------------------------------------------------------------------------

drop policy "finance config managers edit posting rules" on public.posting_rules;

create table public.posting_rule_changes (
  id uuid primary key default gen_random_uuid(),
  transaction_type text not null references public.posting_rules (transaction_type),
  debit_account text references public.ledger_accounts (code),
  credit_account text references public.ledger_accounts (code),
  interest_account text references public.ledger_accounts (code),
  requires_member boolean not null,
  is_active boolean not null,
  reason text not null check (length(trim(reason)) > 0),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  proposed_by uuid not null default auth.uid() references public.staff (id),
  proposed_at timestamptz not null default now(),
  decided_by uuid references public.staff (id),
  decided_at timestamptz,
  decision_note text
);
create unique index posting_rule_changes_one_pending on public.posting_rule_changes (transaction_type) where status = 'pending';

create or replace function app.posting_rule_changes_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rule public.posting_rules;
begin
  if tg_op = 'UPDATE' then
    if not app.in_workflow() then
      raise exception 'a proposed change is approved or rejected, not edited' using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;
  new.status := 'pending';
  new.proposed_by := auth.uid();
  new.proposed_at := now();
  new.decided_by := null;
  new.decided_at := null;
  new.decision_note := null;

  select * into v_rule from public.posting_rules where transaction_type = new.transaction_type;
  -- The bank side of a rule is always the bank account chosen on the transaction.
  if v_rule.direction = 'receipt' then
    new.debit_account := null;
    if new.credit_account is null then
      raise exception 'a receipt rule needs a credit account' using errcode = 'check_violation';
    end if;
  else
    new.credit_account := null;
    new.interest_account := null;
    if new.debit_account is null then
      raise exception 'a payment rule needs a debit account' using errcode = 'check_violation';
    end if;
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

create trigger posting_rule_changes_guard
  before insert or update on public.posting_rule_changes
  for each row execute function app.posting_rule_changes_guard();

select app.enable_audit('public.posting_rule_changes');
alter table public.posting_rule_changes enable row level security;

create policy "finance staff read rule changes" on public.posting_rule_changes for select to authenticated
  using (app.has_permission('accounts.read'));
create policy "proposers suggest rule changes" on public.posting_rule_changes for insert to authenticated
  with check (app.has_permission('accounts.config.propose'));

create or replace function public.decide_posting_rule_change(p_id uuid, p_approve boolean, p_note text default null)
returns public.posting_rule_changes
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_change public.posting_rule_changes;
begin
  select * into v_change from public.posting_rule_changes where id = p_id for update;
  if not found or not app.has_permission('accounts.config.manage') then
    raise exception 'change not found' using errcode = 'no_data_found';
  end if;
  if v_change.status <> 'pending' then
    raise exception 'this change has already been decided' using errcode = 'check_violation';
  end if;
  if v_change.proposed_by = auth.uid() then
    raise exception 'you proposed this change, so someone else must approve it' using errcode = 'insufficient_privilege';
  end if;
  if not p_approve and (p_note is null or length(trim(p_note)) = 0) then
    raise exception 'say why the change is rejected' using errcode = 'check_violation';
  end if;

  perform app.begin_workflow();
  if p_approve then
    update public.posting_rules
       set debit_account = v_change.debit_account,
           credit_account = v_change.credit_account,
           interest_account = v_change.interest_account,
           requires_member = v_change.requires_member,
           is_active = v_change.is_active
     where transaction_type = v_change.transaction_type;
  end if;
  update public.posting_rule_changes
     set status = case when p_approve then 'approved' else 'rejected' end,
         decided_by = auth.uid(), decided_at = now(), decision_note = nullif(trim(p_note), '')
   where id = p_id
   returning * into v_change;
  perform app.end_workflow();
  return v_change;
end;
$$;

-- ---------------------------------------------------------------------------
-- Bank suggestions that learn from earlier postings
-- ---------------------------------------------------------------------------

alter table public.bank_statement_lines
  add column description_key text not null default '',
  add column suggestion_confidence text check (suggestion_confidence in ('high', 'medium', 'low'));
create index bank_statement_lines_key_idx on public.bank_statement_lines (description_key) where description_key <> '';

-- "TRF FROM ADA OBI 0012/44" and "TRF FROM ADA OBI 0013/45" share the key "TRF FROM ADA OBI".
create or replace function app.statement_description_key(p_description text)
returns text
language sql
immutable
set search_path = ''
as $$
  select trim(regexp_replace(upper(coalesce(p_description, '')), '[^A-Z]+', ' ', 'g'));
$$;

-- Sets suggested_type, its reason and a confidence. Keyword rules the finance team approved come first; otherwise
-- earlier lines with the same description that were posted as receipts or payments decide.
create or replace function app.suggest_statement_line(p_line public.bank_statement_lines)
returns public.bank_statement_lines
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_rule public.bank_categorisation_rules;
  v_top record;
  v_total integer;
  v_name text;
begin
  p_line.description_key := app.statement_description_key(p_line.description);
  select r.* into v_rule from public.bank_categorisation_rules r
  where upper(p_line.description) like '%' || upper(r.pattern) || '%'
  order by length(r.pattern) desc
  limit 1;
  if found then
    p_line.suggested_type := v_rule.transaction_type;
    p_line.suggestion_reason := 'Description contains "' || v_rule.pattern || '"';
    p_line.suggestion_confidence := 'high';
    return p_line;
  end if;

  if p_line.description_key = '' then
    return p_line;
  end if;
  select count(*)::integer into v_total
  from public.bank_statement_lines s
  join public.finance_transactions t on t.statement_line_id = s.id and t.status = 'posted'
  where s.description_key = p_line.description_key and (s.amount > 0) = (p_line.amount > 0) and s.id <> p_line.id;
  if v_total = 0 then
    p_line.suggested_type := null;
    p_line.suggestion_reason := null;
    p_line.suggestion_confidence := null;
    return p_line;
  end if;
  select t.transaction_type, count(*)::integer as n into v_top
  from public.bank_statement_lines s
  join public.finance_transactions t on t.statement_line_id = s.id and t.status = 'posted'
  where s.description_key = p_line.description_key and (s.amount > 0) = (p_line.amount > 0) and s.id <> p_line.id
  group by t.transaction_type
  order by count(*) desc, t.transaction_type
  limit 1;
  select name into v_name from public.posting_rules where transaction_type = v_top.transaction_type;

  p_line.suggested_type := v_top.transaction_type;
  p_line.suggestion_confidence := case
    when v_top.n >= 3 and v_top.n = v_total then 'high'
    when v_top.n::numeric / v_total >= 0.75 then 'medium'
    else 'low' end;
  p_line.suggestion_reason := 'Same description as ' || v_top.n || ' earlier line' || case when v_top.n = 1 then '' else 's' end
    || ' posted as ' || v_name
    || case when v_top.n < v_total then ' (' || (v_total - v_top.n) || ' posted differently)' else '' end;
  return p_line;
end;
$$;

create or replace function app.bank_statement_lines_suggest()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  return app.suggest_statement_line(new);
end;
$$;

create trigger bank_statement_lines_suggest
  before insert on public.bank_statement_lines
  for each row execute function app.bank_statement_lines_suggest();

-- Re-runs suggestions for a bank account's unmatched lines, so lines imported before the history existed benefit.
create or replace function public.refresh_statement_suggestions(p_bank_account_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bank public.bank_accounts;
  v_line public.bank_statement_lines;
  v_new public.bank_statement_lines;
  v_changed integer := 0;
begin
  select * into v_bank from public.bank_accounts where id = p_bank_account_id;
  if not found or not app.has_branch_permission('accounts.bank.reconcile', v_bank.branch_id) then
    raise exception 'bank account not found' using errcode = 'no_data_found';
  end if;
  for v_line in
    select * from public.bank_statement_lines where bank_account_id = p_bank_account_id and status = 'unmatched'
  loop
    v_new := app.suggest_statement_line(v_line);
    if v_new.suggested_type is distinct from v_line.suggested_type
       or v_new.suggestion_confidence is distinct from v_line.suggestion_confidence
       or v_new.suggestion_reason is distinct from v_line.suggestion_reason then
      update public.bank_statement_lines
         set description_key = v_new.description_key, suggested_type = v_new.suggested_type,
             suggestion_reason = v_new.suggestion_reason, suggestion_confidence = v_new.suggestion_confidence
       where id = v_line.id;
      v_changed := v_changed + 1;
    end if;
  end loop;
  return v_changed;
end;
$$;

-- Lines imported before this migration get their key and a confidence for their keyword suggestion.
update public.bank_statement_lines
   set description_key = app.statement_description_key(description),
       suggestion_confidence = case when suggested_type is not null then 'high' end;

-- XLSX bank statements are kept with the import, like CSV files.
update storage.buckets
   set allowed_mime_types = array_append(allowed_mime_types, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
 where id = 'finance-evidence'
   and not ('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' = any (allowed_mime_types));

-- ---------------------------------------------------------------------------
-- Function grants
-- ---------------------------------------------------------------------------

revoke all on function public.record_document_issue(uuid, date, text, text) from public, anon;
revoke all on function public.submit_supplier_bill(uuid) from public, anon;
revoke all on function public.approve_supplier_bill(uuid) from public, anon;
revoke all on function public.decline_supplier_bill(uuid, text, text) from public, anon;
revoke all on function public.decide_posting_rule_change(uuid, boolean, text) from public, anon;
revoke all on function public.refresh_statement_suggestions(uuid) from public, anon;
revoke all on function public.staff_options() from public, anon;
revoke all on function public.account_balances(date, date, uuid, uuid, text, text) from public, anon;
revoke all on function public.cash_flow(date, date, uuid, uuid, text, text) from public, anon;
revoke all on function app.suggest_statement_line(public.bank_statement_lines) from public, anon, authenticated;

grant execute on function public.record_document_issue(uuid, date, text, text) to authenticated;
grant execute on function public.submit_supplier_bill(uuid) to authenticated;
grant execute on function public.approve_supplier_bill(uuid) to authenticated;
grant execute on function public.decline_supplier_bill(uuid, text, text) to authenticated;
grant execute on function public.decide_posting_rule_change(uuid, boolean, text) to authenticated;
grant execute on function public.refresh_statement_suggestions(uuid) to authenticated;
grant execute on function public.staff_options() to authenticated;
grant execute on function public.account_balances(date, date, uuid, uuid, text, text) to authenticated;
grant execute on function public.cash_flow(date, date, uuid, uuid, text, text) to authenticated;
