-- Late penalties are applied by the Head of Credit, and members' overdue repayments come out of their savings
-- (sosa, 2026-11-19, answering the walkthrough's open questions: "the penalty should be set by head of credit, and
-- applying a penalty should be optional with the head of credit being the one to apply it. for members there is no
-- penalty fee, the loan and interest is deducted from their savings automatically").
--
-- 1. No penalty builds up by itself any more. Every product's daily rate is set to 0 and the setting is retired.
-- 2. The Head of Credit may apply a penalty to an active loan with an overdue amount. They set it, either as a
--    percentage of what is overdue that day or as an amount, and give a reason. It is owed from that day and is paid
--    the way penalties already were: after the overdue instalments and before the ones not yet due. It is posted to
--    4150 Loan penalty income when paid. The Head of Credit can withdraw a penalty that hasn't been paid.
-- 3. Each night, for a borrower with savings, the overdue instalments (principal and interest) are taken from those
--    savings: oldest plan first, never below zero, skipping a plan with an open liquidation, and leaving a loan alone
--    while Accounts has a repayment for it in progress. No penalty is taken from savings. Each deduction records a
--    "Loan repayment from savings" entry on the plan, a posted journal (debit 2110 Member savings, credit 1210 Loans
--    to members and 4100 Interest on loans) and a repayment on the loan, so the arrears clear.
--    This replaces the nightly late-fee job from 20261119000020; late fees it already took stay recorded.
--
-- Also handles the 'plan_transfer' entries from the partial-liquidation change, so the two can be applied in either
-- order. Re-runnable: safe to paste into the SQL Editor more than once.

-- ---------------------------------------------------------------------------
-- 1. No automatic penalty
-- ---------------------------------------------------------------------------

update public.loan_products set late_penalty_rate = 0 where late_penalty_rate <> 0;
alter table public.loan_products alter column late_penalty_rate set default 0;
comment on column public.loan_products.late_penalty_rate is
  'Retired 2026-11-19: penalties are no longer charged by the day. The Head of Credit applies them (loan_penalty_charges).';

-- ---------------------------------------------------------------------------
-- 2. Penalties the Head of Credit applies
-- ---------------------------------------------------------------------------

create sequence if not exists public.loan_penalty_charge_no_seq;

create table if not exists public.loan_penalty_charges (
  id uuid primary key default gen_random_uuid(),
  charge_no text not null unique,
  loan_id uuid not null references public.loans (id) on delete restrict,
  branch_id uuid not null references public.branches (id),
  -- A restructure starts a new schedule; penalties on the old one are carried into it as unpaid interest.
  schedule_version integer not null,
  charged_on date not null,
  overdue_amount numeric(14, 2) not null check (overdue_amount > 0),
  -- Set when the Head of Credit gave a percentage of the overdue amount rather than an amount.
  rate numeric(7, 4) check (rate is null or (rate > 0 and rate <= 100)),
  amount numeric(14, 2) not null check (amount > 0),
  reason text not null check (length(trim(reason)) >= 5),
  charged_by uuid not null references public.staff (id),
  created_at timestamptz not null default now(),
  withdrawn_at timestamptz,
  withdrawn_by uuid references public.staff (id),
  withdraw_reason text,
  constraint loan_penalty_charges_withdrawn check ((withdrawn_at is null) = (withdrawn_by is null))
);
create index if not exists loan_penalty_charges_loan_idx on public.loan_penalty_charges (loan_id, schedule_version);

create or replace function app.loan_penalty_charges_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not app.in_workflow() then
    raise exception 'penalties are applied and withdrawn by the Head of Credit from the loan page' using errcode = 'insufficient_privilege';
  end if;
  if tg_op = 'DELETE' then
    raise exception 'penalties are never deleted; withdraw them instead' using errcode = 'insufficient_privilege';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists loan_penalty_charges_guard on public.loan_penalty_charges;
create trigger loan_penalty_charges_guard
  before insert or update or delete on public.loan_penalty_charges
  for each row execute function app.loan_penalty_charges_guard();

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'audit_log_changes' and tgrelid = 'public.loan_penalty_charges'::regclass) then
    perform app.enable_audit('public.loan_penalty_charges');
  end if;
end;
$$;

alter table public.loan_penalty_charges enable row level security;
drop policy if exists "credit, member and finance staff read loan penalties" on public.loan_penalty_charges;
create policy "credit, member and finance staff read loan penalties" on public.loan_penalty_charges
  for select to authenticated
  using (
    app.has_branch_permission('credit.read', branch_id)
    or app.has_branch_permission('members.read', branch_id)
    or app.has_branch_permission('accounts.read', branch_id)
  );

-- The penalty owed on a loan's current schedule up to the end of p_as_of: the penalties the Head of Credit has applied
-- and not withdrawn. Same name and arguments as before, so repayments, restructures and the loan book use it unchanged.
create or replace function app.loan_penalty_accrued(p_loan_id uuid, p_as_of date)
returns numeric
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(c.amount), 0)::numeric
  from public.loan_penalty_charges c
  join public.loans l on l.id = c.loan_id
  where c.loan_id = p_loan_id
    and c.schedule_version = l.schedule_version
    and c.withdrawn_at is null
    and c.charged_on <= p_as_of;
$$;
grant execute on function app.loan_penalty_accrued(uuid, date) to authenticated;

-- What the current schedule has had paid towards penalties (receipts and older savings deductions).
create or replace function app.loan_penalty_paid(p_loan_id uuid)
returns numeric
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(r.penalty), 0)::numeric
  from public.loan_repayments r
  join public.loans l on l.id = r.loan_id
  where r.loan_id = p_loan_id and r.schedule_version = l.schedule_version and r.reversed_at is null;
$$;
grant execute on function app.loan_penalty_paid(uuid) to authenticated;

create or replace function public.apply_loan_penalty(p_loan_id uuid, p_rate numeric, p_amount numeric, p_reason text)
returns public.loan_penalty_charges
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_was_on boolean := app.in_workflow();
  v_loan public.loans;
  v_overdue numeric;
  v_amount numeric;
  v_row public.loan_penalty_charges;
begin
  select * into v_loan from public.loans where id = p_loan_id for update;
  if not found or not app.has_branch_permission('credit.read', v_loan.branch_id) then
    raise exception 'loan not found' using errcode = 'no_data_found';
  end if;
  if not app.has_branch_permission('credit.approve', v_loan.branch_id) then
    raise exception 'only the Head of Credit can apply a penalty' using errcode = 'insufficient_privilege';
  end if;
  if v_loan.status <> 'active' then
    raise exception 'a penalty can only be applied to an active loan' using errcode = 'check_violation';
  end if;
  select coalesce(sum(s.outstanding), 0) into v_overdue
  from public.loan_schedule_status s
  where s.loan_id = p_loan_id and s.due_date < current_date;
  if v_overdue <= 0 then
    raise exception 'this loan has nothing overdue, so there is nothing to apply a penalty to' using errcode = 'check_violation';
  end if;
  if (p_rate is null) = (p_amount is null) then
    raise exception 'give either a percentage of the overdue amount or an amount' using errcode = 'check_violation';
  end if;
  if p_rate is not null and (p_rate <= 0 or p_rate > 100) then
    raise exception 'the percentage must be more than 0 and at most 100' using errcode = 'check_violation';
  end if;
  v_amount := round(coalesce(p_amount, v_overdue * p_rate / 100), 2);
  if v_amount <= 0 then
    raise exception 'the penalty must be more than zero' using errcode = 'check_violation';
  end if;
  if p_reason is null or length(trim(p_reason)) < 5 then
    raise exception 'say why the penalty is being applied' using errcode = 'check_violation';
  end if;

  perform app.begin_workflow();
  insert into public.loan_penalty_charges
    (charge_no, loan_id, branch_id, schedule_version, charged_on, overdue_amount, rate, amount, reason, charged_by)
  values
    ('PEN-' || lpad(nextval('public.loan_penalty_charge_no_seq')::text, 6, '0'), p_loan_id, v_loan.branch_id,
     v_loan.schedule_version, current_date, round(v_overdue, 2), p_rate, v_amount, trim(p_reason), auth.uid())
  returning * into v_row;
  if not v_was_on then
    perform app.end_workflow();
  end if;
  return v_row;
end;
$$;
revoke all on function public.apply_loan_penalty(uuid, numeric, numeric, text) from public, anon;
grant execute on function public.apply_loan_penalty(uuid, numeric, numeric, text) to authenticated;

-- Withdraws a penalty that hasn't been paid. Payments are matched to penalties as a total, so a penalty can be
-- withdrawn only while the loan's unpaid penalty is at least its amount.
create or replace function public.withdraw_loan_penalty(p_charge_id uuid, p_reason text)
returns public.loan_penalty_charges
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_was_on boolean := app.in_workflow();
  v_row public.loan_penalty_charges;
  v_loan public.loans;
begin
  select * into v_row from public.loan_penalty_charges where id = p_charge_id;
  if not found then
    raise exception 'penalty not found' using errcode = 'no_data_found';
  end if;
  select * into v_loan from public.loans where id = v_row.loan_id for update;
  if not app.has_branch_permission('credit.approve', v_loan.branch_id) then
    raise exception 'only the Head of Credit can withdraw a penalty' using errcode = 'insufficient_privilege';
  end if;
  if v_row.withdrawn_at is not null then
    raise exception 'this penalty has already been withdrawn' using errcode = 'check_violation';
  end if;
  if v_row.schedule_version <> v_loan.schedule_version then
    raise exception 'this penalty was carried into a restructure and can''t be withdrawn' using errcode = 'check_violation';
  end if;
  if app.loan_penalty_accrued(v_loan.id, current_date) - app.loan_penalty_paid(v_loan.id) < v_row.amount then
    raise exception 'this penalty has already been paid, in part or in full' using errcode = 'check_violation';
  end if;
  if exists (
    select 1 from public.finance_transactions t
    where t.loan_id = v_loan.id and t.transaction_type = 'loan_repayment' and t.status in ('draft', 'submitted', 'returned', 'approved')
  ) then
    raise exception 'a repayment for this loan is going through Accounts; withdraw the penalty once it has posted' using errcode = 'check_violation';
  end if;
  if p_reason is null or length(trim(p_reason)) < 5 then
    raise exception 'say why the penalty is being withdrawn' using errcode = 'check_violation';
  end if;

  perform app.begin_workflow();
  update public.loan_penalty_charges
     set withdrawn_at = now(), withdrawn_by = auth.uid(), withdraw_reason = trim(p_reason)
   where id = p_charge_id
  returning * into v_row;
  if not v_was_on then
    perform app.end_workflow();
  end if;
  return v_row;
end;
$$;
revoke all on function public.withdraw_loan_penalty(uuid, text) from public, anon;
grant execute on function public.withdraw_loan_penalty(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Overdue repayments taken from savings
-- ---------------------------------------------------------------------------

alter type public.contribution_kind add value if not exists 'loan_deduction';

-- New enum values can't be used as literals in the transaction that adds them, so these compare as text.
alter table public.contributions drop constraint if exists contributions_sign;
alter table public.contributions add constraint contributions_sign check (
  (kind::text in ('reversal', 'loan_penalty', 'loan_deduction') and amount < 0)
  or (kind::text = 'plan_transfer' and amount <> 0)
  or (kind::text not in ('reversal', 'loan_penalty', 'loan_deduction', 'plan_transfer') and amount > 0)
);
alter table public.contributions drop constraint if exists contributions_payment_method_check;
alter table public.contributions add constraint contributions_payment_method_check
  check (payment_method in ('bank_transfer', 'cash', 'pos', 'cheque', 'savings_deduction', 'plan_transfer'));
alter table public.contributions drop constraint if exists contributions_deduction_method;
alter table public.contributions add constraint contributions_deduction_method
  check ((kind::text in ('loan_penalty', 'loan_deduction')) = (payment_method = 'savings_deduction'));
alter table public.contributions drop constraint if exists contributions_transfer_method;
alter table public.contributions add constraint contributions_transfer_method
  check ((kind::text = 'plan_transfer') = (payment_method = 'plan_transfer'));

-- Unchanged, except that a loan repayment from savings, like a late fee, is written only by the nightly job and
-- arrives already verified.
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

  if new.kind = 'top_up' and not app.in_workflow() then
    raise exception 'top ups come from Accounts: log the top up Accounts sent to your branch' using errcode = 'insufficient_privilege';
  end if;
  if new.kind::text = 'loan_penalty' and not app.in_workflow() then
    raise exception 'loan late fees are taken from savings automatically' using errcode = 'insufficient_privilege';
  end if;
  if new.kind::text = 'loan_deduction' and not app.in_workflow() then
    raise exception 'overdue loan repayments are taken from savings automatically' using errcode = 'insufficient_privilege';
  end if;
  if new.kind::text = 'plan_transfer' and not app.in_workflow() then
    raise exception 'savings move between plans only through a liquidation' using errcode = 'insufficient_privilege';
  end if;

  if new.paid_on > current_date then
    raise exception 'payment date can''t be in the future' using errcode = 'check_violation';
  end if;

  select * into v_plan from public.member_plans where id = new.member_plan_id;
  if v_plan.status <> 'active' and not (new.kind::text = 'plan_transfer' and v_plan.status = 'matured') then
    raise exception 'contributions can only be recorded on active plans' using errcode = 'check_violation';
  end if;

  new.member_id := v_plan.member_id;
  new.branch_id := v_plan.branch_id;
  new.recorded_by := auth.uid();
  new.recorded_at := now();
  new.verified_by := null;
  if new.kind::text in ('loan_penalty', 'loan_deduction', 'plan_transfer') then
    new.verified_at := now();
  else
    new.verified_at := null;
  end if;

  if new.kind = 'reversal' then
    select * into v_original from public.contributions where id = new.reverses_id;
    if v_original.member_plan_id is distinct from new.member_plan_id then
      raise exception 'a reversal must be on the same plan as the entry it reverses' using errcode = 'check_violation';
    end if;
    if v_original.kind = 'reversal' or v_original.kind::text in ('loan_penalty', 'loan_deduction', 'plan_transfer') then
      raise exception 'a reversal can''t itself be reversed, and deductions for loans and moves between plans aren''t reversed here'
        using errcode = 'check_violation';
    end if;
    if new.amount <> -v_original.amount then
      raise exception 'a reversal must be for exactly the original amount' using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

-- Deductions are already in the ledger and moves stay in Member savings, so Accounts doesn't post them.
create or replace view public.contributions_awaiting_posting with (security_invoker = true) as
select c.id, c.member_id, c.member_plan_id, c.branch_id, c.kind, c.amount, c.paid_on, c.payment_method, c.reference,
       c.verified_at, concat_ws(' ', m.first_name, m.middle_name, m.last_name) as member_name, m.membership_no
from public.contributions c
join public.members m on m.id = c.member_id
where c.verified_at is not null
  and c.kind::text not in ('loan_penalty', 'loan_deduction', 'plan_transfer')
  and not exists (
    select 1 from public.finance_transactions t where t.contribution_id = c.id and t.status <> 'rejected'
  );
grant select on public.contributions_awaiting_posting to authenticated;

-- A repayment from savings has no Accounts receipt behind it. Older ones (late fees) carry only a penalty.
alter table public.loan_repayments drop constraint if exists loan_repayments_source;
alter table public.loan_repayments add constraint loan_repayments_source check (
  (source = 'receipt' and finance_transaction_id is not null)
  or (source = 'savings' and finance_transaction_id is null)
);

create sequence if not exists public.loan_savings_deduction_no_seq;

create table if not exists public.loan_savings_deductions (
  id uuid primary key default gen_random_uuid(),
  deduction_no text not null unique,
  loan_id uuid not null references public.loans (id) on delete restrict,
  member_id uuid not null references public.members (id),
  member_plan_id uuid not null references public.member_plans (id) on delete restrict,
  branch_id uuid not null references public.branches (id),
  amount numeric(14, 2) not null check (amount > 0),
  principal numeric(14, 2) not null check (principal >= 0),
  interest numeric(14, 2) not null check (interest >= 0),
  deducted_on date not null,
  contribution_id uuid not null unique references public.contributions (id),
  journal_entry_id uuid not null unique references public.journal_entries (id),
  loan_repayment_id uuid not null unique references public.loan_repayments (id),
  created_at timestamptz not null default now(),
  constraint loan_savings_deductions_split check (principal + interest = amount)
);
create index if not exists loan_savings_deductions_loan_idx on public.loan_savings_deductions (loan_id);
create index if not exists loan_savings_deductions_plan_idx on public.loan_savings_deductions (member_plan_id);
create index if not exists loan_savings_deductions_date_idx on public.loan_savings_deductions (deducted_on);

create or replace function app.loan_savings_deductions_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not app.in_workflow() or tg_op <> 'INSERT' then
    raise exception 'loan repayments from savings are recorded only by the nightly job' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

drop trigger if exists loan_savings_deductions_guard on public.loan_savings_deductions;
create trigger loan_savings_deductions_guard
  before insert or update or delete on public.loan_savings_deductions
  for each row execute function app.loan_savings_deductions_guard();

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'audit_log_changes' and tgrelid = 'public.loan_savings_deductions'::regclass) then
    perform app.enable_audit('public.loan_savings_deductions');
  end if;
end;
$$;

alter table public.loan_savings_deductions enable row level security;
drop policy if exists "credit, member and finance staff read loan repayments from savings" on public.loan_savings_deductions;
create policy "credit, member and finance staff read loan repayments from savings" on public.loan_savings_deductions
  for select to authenticated
  using (
    app.has_branch_permission('credit.read', branch_id)
    or app.has_branch_permission('members.read', branch_id)
    or app.has_branch_permission('accounts.read', branch_id)
  );

-- Takes every active loan's overdue instalments (principal and interest, due before p_as_of) from the borrower's
-- savings. Returns how many deductions it made. Runs as the owner; nobody signed in can call it.
create or replace function app.recover_loan_arrears_from_savings(p_as_of date default current_date)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_was_on boolean := app.in_workflow();
  v_loan public.loans;
  v_plan public.member_plans;
  v_owed numeric;
  v_savings numeric;
  v_take numeric;
  v_paid_p numeric;
  v_paid_i numeric;
  v_paid_pen numeric;
  v_split record;
  v_no text;
  v_line integer;
  v_contribution_id uuid;
  v_entry_id uuid;
  v_repayment_id uuid;
  v_count integer := 0;
begin
  if p_as_of is null or p_as_of > current_date then
    raise exception 'repayments can''t be taken from savings for a future date' using errcode = 'check_violation';
  end if;
  perform app.begin_workflow();

  for v_loan in
    select l.* from public.loans l
    where l.status = 'active'
      and exists (select 1 from public.member_plans p where p.member_id = l.member_id and p.status = 'active')
      -- Leave a loan alone while Accounts has a repayment for it in progress.
      and not exists (
        select 1 from public.finance_transactions t
        where t.loan_id = l.id and t.transaction_type = 'loan_repayment'
          and t.status in ('draft', 'submitted', 'returned', 'approved')
      )
    order by l.loan_no
    for update of l skip locked
  loop
    select round(coalesce(sum(s.outstanding), 0), 2) into v_owed
    from public.loan_schedule_status s
    where s.loan_id = v_loan.id and s.due_date < p_as_of;
    continue when v_owed <= 0;

    for v_plan in
      select p.* from public.member_plans p
      where p.member_id = v_loan.member_id and p.status = 'active'
        and not exists (
          select 1 from public.plan_liquidations q
          where q.member_plan_id = p.id and q.status in ('pending_approval', 'returned', 'approved')
        )
      order by p.start_date, p.created_at
      for update of p
    loop
      exit when v_owed <= 0;
      select coalesce(sum(c.amount), 0) into v_savings
      from public.contributions c
      where c.member_plan_id = v_plan.id and c.verified_at is not null and c.paid_on <= p_as_of;
      v_take := least(v_owed, greatest(0, v_savings));
      continue when v_take <= 0;

      -- Split it the way a receipt would be: overdue interest then principal, oldest instalment first.
      select coalesce(sum(r.principal), 0), coalesce(sum(r.interest), 0), coalesce(sum(r.penalty), 0)
        into v_paid_p, v_paid_i, v_paid_pen
      from public.loan_repayments r
      where r.loan_id = v_loan.id and r.schedule_version = v_loan.schedule_version and r.reversed_at is null;
      select * into v_split from app.loan_allocate(v_loan.id, v_take, v_paid_p, v_paid_i, v_paid_pen, p_as_of);
      -- Only arrears are taken, so nothing should reach the penalty; if it would, take only the instalment part.
      if v_split.penalty > 0 then
        v_take := v_split.principal + v_split.interest;
        continue when v_take <= 0;
      end if;

      v_no := 'LRS-' || lpad(nextval('public.loan_savings_deduction_no_seq')::text, 6, '0');

      insert into public.contributions (member_plan_id, member_id, branch_id, kind, amount, paid_on, payment_method, reference, notes)
      values (v_plan.id, v_plan.member_id, v_plan.branch_id, 'loan_deduction', -v_take, p_as_of, 'savings_deduction', v_no,
              'Overdue repayment on loan ' || v_loan.loan_no || ' taken from savings')
      returning id into v_contribution_id;

      insert into public.journal_entries (branch_id, entry_date, description, source, status, created_by, posted_by, posted_at)
      values (v_plan.branch_id, p_as_of, v_no || ' Overdue repayment on loan ' || v_loan.loan_no || ' taken from savings',
              'savings_recovery', 'draft', null, null, now())
      returning id into v_entry_id;
      insert into public.journal_lines (entry_id, line_no, account_code, debit, member_id, plan_type, description)
      values (v_entry_id, 1, '2110', v_take, v_loan.member_id, v_plan.plan_type, 'Loan repayment taken from savings');
      v_line := 2;
      if v_split.principal > 0 then
        insert into public.journal_lines (entry_id, line_no, account_code, credit, member_id, description)
        values (v_entry_id, v_line, '1210', v_split.principal, v_loan.member_id, 'Loan ' || v_loan.loan_no || ' principal');
        v_line := v_line + 1;
      end if;
      if v_split.interest > 0 then
        insert into public.journal_lines (entry_id, line_no, account_code, credit, member_id, description)
        values (v_entry_id, v_line, '4100', v_split.interest, v_loan.member_id, 'Loan ' || v_loan.loan_no || ' interest');
      end if;
      perform app.assert_balanced(v_entry_id);
      update public.journal_entries set status = 'posted' where id = v_entry_id;

      insert into public.loan_repayments
        (loan_id, branch_id, finance_transaction_id, txn_no, paid_on, amount, principal, interest, penalty, schedule_version, source)
      values (v_loan.id, v_loan.branch_id, null, v_no, p_as_of, v_take, v_split.principal, v_split.interest, 0,
              v_loan.schedule_version, 'savings')
      returning id into v_repayment_id;

      insert into public.loan_savings_deductions
        (deduction_no, loan_id, member_id, member_plan_id, branch_id, amount, principal, interest, deducted_on, contribution_id,
         journal_entry_id, loan_repayment_id)
      values (v_no, v_loan.id, v_loan.member_id, v_plan.id, v_plan.branch_id, v_take, v_split.principal, v_split.interest, p_as_of,
              v_contribution_id, v_entry_id, v_repayment_id);

      v_owed := v_owed - v_take;
      v_count := v_count + 1;
    end loop;

    -- A loan with nothing left on its schedule and no unpaid penalty closes, as with a receipt.
    if not exists (select 1 from public.loan_schedule_status s where s.loan_id = v_loan.id and s.outstanding > 0)
       and app.loan_penalty_accrued(v_loan.id, p_as_of) <= app.loan_penalty_paid(v_loan.id) then
      update public.loans set status = 'closed', closed_on = p_as_of where id = v_loan.id;
    end if;
  end loop;

  if not v_was_on then
    perform app.end_workflow();
  end if;
  return v_count;
end;
$$;
revoke all on function app.recover_loan_arrears_from_savings(date) from public, anon, authenticated;

-- The late-fee job is replaced.
drop function if exists app.recover_loan_penalties_from_savings(date);

-- Run every day at 01:00 UTC (02:00 in Lagos) where pg_cron is available, as it is on Supabase.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
    if exists (select 1 from cron.job where jobname = 'loan-late-fees-from-savings') then
      perform cron.unschedule('loan-late-fees-from-savings');
    end if;
    perform cron.schedule('loan-arrears-from-savings', '0 1 * * *', 'select app.recover_loan_arrears_from_savings()');
  end if;
end;
$$;
