-- Two flows from the Accounts department flowchart:
--   1. Receipt confirmation: when Accounts keys in money a member paid into a savings plan (or as capital), Operations
--      checks it against the member's records before Accounts can confirm and post it.
--   2. Monthly interest payments: each member's bank details and interest pay day, the CBN bank code list, plan
--      interest rates, and the daily payment schedule the Payments accountant works from.

-- ===========================================================================
-- 1. Operations confirms member receipts
-- ===========================================================================

insert into public.permissions (code, description) values
  ('receipts.confirm', 'Check receipts Accounts recorded for members against the member''s records, before they are posted');

insert into public.role_permissions (role_code, permission_code) values
  ('admin_officer', 'receipts.confirm'),
  ('branch_manager', 'receipts.confirm'),
  ('head_of_administration', 'receipts.confirm');

alter table public.finance_transactions
  add column member_plan_id uuid references public.member_plans (id),
  -- Savings and capital that Accounts keys in itself. Receipts from contributions were already verified in Operations.
  add column needs_ops_confirmation boolean generated always as (
    direction = 'receipt' and transaction_type in ('member_savings', 'member_capital') and contribution_id is null
  ) stored,
  add column ops_confirmed_by uuid references public.staff (id),
  add column ops_confirmed_at timestamptz,
  add column ops_note text;

create index finance_transactions_awaiting_ops_idx on public.finance_transactions (branch_id)
  where needs_ops_confirmation and status = 'submitted' and ops_confirmed_at is null;

-- Runs after the other finance_transactions guards (alphabetical order). The plan must be the member's; Operations'
-- confirmation is recorded only through confirm_member_receipt().
create or replace function app.finance_transactions_plan_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan public.member_plans;
begin
  if app.in_workflow() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.ops_confirmed_by := null;
    new.ops_confirmed_at := null;
    new.ops_note := null;
  elsif new.ops_confirmed_by is distinct from old.ops_confirmed_by
     or new.ops_confirmed_at is distinct from old.ops_confirmed_at
     or new.ops_note is distinct from old.ops_note then
    raise exception 'Operations'' confirmation is recorded only through the receipt workflow' using errcode = 'insufficient_privilege';
  end if;

  if new.contribution_id is not null and new.direction = 'receipt' then
    select member_plan_id into new.member_plan_id from public.contributions where id = new.contribution_id;
  end if;

  if new.member_plan_id is not null then
    select * into v_plan from public.member_plans where id = new.member_plan_id;
    if new.direction <> 'receipt' then
      raise exception 'only receipts are linked to a savings plan' using errcode = 'check_violation';
    end if;
    if v_plan.member_id is distinct from new.member_id then
      raise exception 'the savings plan must belong to the member' using errcode = 'check_violation';
    end if;
    if v_plan.status <> 'active' and new.contribution_id is null then
      raise exception 'money can only be received into an active plan' using errcode = 'check_violation';
    end if;
    new.plan_type := coalesce(new.plan_type, v_plan.plan_type);
  end if;
  return new;
end;
$$;

create trigger finance_transactions_plan_guard
  before insert or update on public.finance_transactions
  for each row execute function app.finance_transactions_plan_guard();

-- Unchanged, except that savings receipts name the plan, and (re)submitting clears any earlier Operations confirmation.
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
  if v_txn.needs_ops_confirmation and v_txn.transaction_type = 'member_savings' and v_txn.member_plan_id is null then
    raise exception 'choose the savings plan the money was paid into' using errcode = 'check_violation';
  end if;

  perform app.begin_workflow();
  update public.finance_transactions
     set status = 'submitted', submitted_by = auth.uid(), submitted_at = now(), decision_reason = null,
         ops_confirmed_by = null, ops_confirmed_at = null, ops_note = null
   where id = p_id
   returning * into v_txn;
  perform app.end_workflow();
  return v_txn;
end;
$$;

-- Operations has checked the amount, member and plan against the member's records.
create or replace function public.confirm_member_receipt(p_id uuid, p_note text)
returns public.finance_transactions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_txn public.finance_transactions;
begin
  select * into v_txn from public.finance_transactions where id = p_id for update;
  if not found or not app.has_branch_permission('receipts.confirm', v_txn.branch_id) then
    raise exception 'receipt not found' using errcode = 'no_data_found';
  end if;
  if not v_txn.needs_ops_confirmation or v_txn.status <> 'submitted' or v_txn.ops_confirmed_at is not null then
    raise exception 'only submitted member receipts waiting for Operations can be confirmed' using errcode = 'check_violation';
  end if;
  if auth.uid() in (v_txn.created_by, v_txn.submitted_by) then
    raise exception 'you recorded this receipt, so someone in Operations must confirm it' using errcode = 'insufficient_privilege';
  end if;

  perform app.begin_workflow();
  update public.finance_transactions
     set ops_confirmed_by = auth.uid(), ops_confirmed_at = now(), ops_note = nullif(trim(coalesce(p_note, '')), '')
   where id = p_id
   returning * into v_txn;
  perform app.end_workflow();
  return v_txn;
end;
$$;

-- Operations can't match the receipt to the member's records: it goes back to Accounts with the reason.
create or replace function public.return_member_receipt(p_id uuid, p_reason text)
returns public.finance_transactions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_txn public.finance_transactions;
begin
  select * into v_txn from public.finance_transactions where id = p_id for update;
  if not found or not app.has_branch_permission('receipts.confirm', v_txn.branch_id) then
    raise exception 'receipt not found' using errcode = 'no_data_found';
  end if;
  if not v_txn.needs_ops_confirmation or v_txn.status <> 'submitted' or v_txn.ops_confirmed_at is not null then
    raise exception 'only submitted member receipts waiting for Operations can be returned here' using errcode = 'check_violation';
  end if;
  if auth.uid() in (v_txn.created_by, v_txn.submitted_by) then
    raise exception 'you recorded this receipt, so someone in Operations must review it' using errcode = 'insufficient_privilege';
  end if;
  if p_reason is null or length(trim(p_reason)) < 5 then
    raise exception 'say what doesn''t match the member''s records' using errcode = 'check_violation';
  end if;

  perform app.begin_workflow();
  update public.finance_transactions
     set status = 'returned', decision_reason = 'Operations: ' || trim(p_reason)
   where id = p_id
   returning * into v_txn;
  perform app.end_workflow();
  return v_txn;
end;
$$;

-- Unchanged, except that member receipts need Operations' confirmation first.
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
  if v_txn.needs_ops_confirmation and v_txn.ops_confirmed_at is null then
    raise exception 'Operations has to confirm this receipt against the member''s records first' using errcode = 'check_violation';
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

-- Operations staff can't read Accounts' transactions, so their queue comes from here: only member receipts waiting for
-- them, in branches where they may confirm receipts, with what they need to check.
create or replace function public.receipts_to_confirm()
returns table (
  id uuid, txn_no text, branch_id uuid, txn_date date, amount numeric, transaction_type text, type_name text,
  reference text, counterparty text, description text, bank_account_name text,
  member_id uuid, member_name text, membership_no text, member_plan_id uuid, plan_type text, plan_name text,
  recorded_by uuid, recorded_by_name text, submitted_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select t.id, t.txn_no, t.branch_id, t.txn_date, t.amount, t.transaction_type, r.name,
         t.reference, t.counterparty, t.description, b.name,
         m.id, concat_ws(' ', m.first_name, m.middle_name, m.last_name), m.membership_no, p.id, p.plan_type, pt.name,
         t.created_by, s.full_name, t.submitted_at
  from public.finance_transactions t
  join public.posting_rules r on r.transaction_type = t.transaction_type
  join public.bank_accounts b on b.id = t.bank_account_id
  join public.members m on m.id = t.member_id
  join public.staff s on s.id = t.created_by
  left join public.member_plans p on p.id = t.member_plan_id
  left join public.plan_types pt on pt.code = p.plan_type
  where t.needs_ops_confirmation and t.status = 'submitted' and t.ops_confirmed_at is null
    and app.has_branch_permission('receipts.confirm', t.branch_id)
  order by t.submitted_at;
$$;

revoke all on function public.confirm_member_receipt(uuid, text) from public, anon;
revoke all on function public.return_member_receipt(uuid, text) from public, anon;
revoke all on function public.receipts_to_confirm() from public, anon;
grant execute on function public.confirm_member_receipt(uuid, text) to authenticated;
grant execute on function public.return_member_receipt(uuid, text) to authenticated;
grant execute on function public.receipts_to_confirm() to authenticated;

-- ===========================================================================
-- 2. Monthly interest payments
-- ===========================================================================

-- CBN bank codes, from the Accounts department flowchart. Banks without a code are entered by name only.
create table public.cbn_banks (
  code text primary key check (code ~ '^[0-9]{3}$'),
  bank_id text not null,
  name text not null unique
);

insert into public.cbn_banks (code, bank_id, name) values
  ('001', 'CBNINGLAXXX', 'Central Bank of Nigeria'),
  ('011', '011153166', 'First Bank of Nigeria (FBN)'),
  ('023', '023150034', 'Citibank'),
  ('030', '030150014', 'Heritage Bank'),
  ('032', '032080425', 'Union Bank'),
  ('033', '033152666', 'United Bank for Africa (UBA)'),
  ('035', '035340159', 'Wema Bank'),
  ('044', '044150039', 'Access Bank Plc'),
  ('050', '050150311', 'Ecobank'),
  ('057', '057020046', 'Zenith Bank'),
  ('058', '058152049', 'GTBank'),
  ('063', '063150023', 'Diamond Bank'),
  ('068', '068120016', 'Standard Chartered Bank'),
  ('070', '070020926', 'Fidelity Bank Plc'),
  ('076', '076151365', 'Polaris Bank'),
  ('082', '082150033', 'Keystone Bank'),
  ('100', '100152041', 'SunTrust Bank Nigeria Ltd'),
  ('101', '101152019', 'Providus Bank Nigeria Limited'),
  ('102', '102150010', 'Titan Trust Bank Ltd'),
  ('103', '103150019', 'Globus Bank'),
  ('104', '104150005', 'Parallex Bank'),
  ('105', '105150004', 'PremiumTrust Bank'),
  ('214', '214159996', 'FCMB'),
  ('215', '215203634', 'Unity Bank Plc'),
  ('221', '221159522', 'Stanbic IBTC Bank Plc'),
  ('232', '232150032', 'Sterling Bank Plc'),
  ('301', '301080020', 'Jaiz Bank'),
  ('302', '302080016', 'TAJ Bank'),
  ('303', '303150013', 'Lotus Bank'),
  ('501', '501150019', 'FSDH Merchant Bank Ltd'),
  ('559', '559159994', 'Coronation Merchant Bank Ltd'),
  ('561', '561150017', 'Nova Merchant Bank');

alter table public.cbn_banks enable row level security;
create policy "staff can read bank codes" on public.cbn_banks for select to authenticated using (true);
create policy "system admins manage bank codes" on public.cbn_banks for all to authenticated
  using (app.has_permission('system.manage')) with check (app.has_permission('system.manage'));
select app.enable_audit('public.cbn_banks');

-- Where and when the member's monthly interest is paid. They are ordinary member details: the officer fills them in,
-- and changing them on an approved member needs a reason, like any other change.
alter table public.members
  add column bank_code text references public.cbn_banks (code),
  add column bank_name text check (bank_name is null or length(trim(bank_name)) > 0),
  add column bank_account_no text check (bank_account_no is null or bank_account_no ~ '^[0-9]{10}$'),
  -- Day of the month interest is paid. In shorter months, days past the end are paid on the last day.
  add column interest_pay_day smallint check (interest_pay_day between 1 and 31),
  add constraint members_bank_details check ((bank_name is null) = (bank_account_no is null));

-- A coded bank always carries the name from the CBN list.
create or replace function app.members_bank_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.bank_code is not null then
    select name into new.bank_name from public.cbn_banks where code = new.bank_code;
  end if;
  return new;
end;
$$;

create trigger members_bank_guard
  before insert or update of bank_code, bank_name on public.members
  for each row execute function app.members_bank_guard();

-- Annual interest rate per plan. The figures are placeholders until Kuun confirms its rates and interest formula.
alter table public.plan_types
  add column interest_rate numeric(5, 2) not null default 0 check (interest_rate between 0 and 100);
update public.plan_types set interest_rate = case code when 'silver' then 10 when 'gold' then 12 when 'platinum' then 15 else 0 end;

-- Each plan keeps the rate it was opened at, so a later change to the plan type doesn't rewrite existing plans.
alter table public.member_plans
  add column interest_rate numeric(5, 2) check (interest_rate between 0 and 100);
update public.member_plans p set interest_rate = t.interest_rate from public.plan_types t where t.code = p.plan_type;
alter table public.member_plans alter column interest_rate set not null;

create or replace function app.member_plans_rate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    select interest_rate into new.interest_rate from public.plan_types where code = new.plan_type;
  end if;
  return new;
end;
$$;

create trigger member_plans_rate
  before insert on public.member_plans
  for each row execute function app.member_plans_rate();

-- The payments due on a date: members whose interest pay day it is, with their bank details, savings at that date and
-- the month's interest. Placeholder formula until Kuun confirms it: for each active plan, verified contributions to
-- date times the plan's annual rate, divided by 12.
create or replace function public.interest_payment_schedule(p_date date, p_branch_id uuid default null, p_region_id uuid default null)
returns table (
  member_id uuid, membership_no text, beneficiary_name text, branch_id uuid, branch_name text,
  bank_name text, bank_code text, bank_account_no text, total_savings numeric, interest_rate numeric, amount numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  with due as (
    select m.*, b.name as branch_name
    from public.members m
    join public.branches b on b.id = m.branch_id
    where m.status = 'approved'
      and m.interest_pay_day is not null
      and (m.interest_pay_day = extract(day from p_date)
           or (p_date = (date_trunc('month', p_date) + interval '1 month - 1 day')::date
               and m.interest_pay_day > extract(day from p_date)))
      and (p_branch_id is null or m.branch_id = p_branch_id)
      and (p_region_id is null or b.region_id = p_region_id)
  ),
  plans as (
    select p.member_id, p.interest_rate, coalesce(sum(c.amount), 0) as savings
    from public.member_plans p
    join due d on d.id = p.member_id
    left join public.contributions c on c.member_plan_id = p.id and c.verified_at is not null and c.paid_on <= p_date
    where p.status = 'active' and p.start_date <= p_date
    group by p.id
  )
  select d.id, d.membership_no, concat_ws(' ', d.first_name, d.middle_name, d.last_name), d.branch_id, d.branch_name,
         d.bank_name, d.bank_code, d.bank_account_no,
         sum(p.savings)::numeric(16, 2),
         round(sum(p.savings * p.interest_rate) / sum(p.savings), 2),
         sum(round(p.savings * p.interest_rate / 100 / 12, 2))::numeric(16, 2)
  from due d
  join plans p on p.member_id = d.id
  group by d.id, d.membership_no, d.first_name, d.middle_name, d.last_name, d.branch_id, d.branch_name,
           d.bank_name, d.bank_code, d.bank_account_no
  having sum(p.savings) > 0
  order by d.branch_name, d.last_name, d.first_name;
$$;
