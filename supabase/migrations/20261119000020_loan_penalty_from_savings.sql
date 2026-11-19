-- Late fees taken from a defaulting member's savings (sosa, 2026-11-19: "when members with contributions default, the
-- late fee should be charged from their contributions"; automatic, with no approval step).
--
-- Every day a job looks at each active loan that owes a late penalty. If the borrower has verified savings on an active
-- plan, the unpaid penalty is taken from those savings:
--   * oldest plan first, never taking a plan below zero, and skipping a plan that has an open liquidation request;
--   * only the penalty is taken; missed instalments stay owed on the loan;
--   * a loan with a repayment still going through Accounts is left for that day, so the job doesn't change the
--     penalty split Accounts has already worked out.
-- For each plan it takes from, it records:
--   1. a "Loan late fee" deduction on the plan (a negative, already verified contribution), so the plan's savings, its
--      interest and every statement show the lower balance from that day;
--   2. a posted journal: debit 2110 Member savings (with the member), credit 4150 Loan penalty income. No cash moves;
--   3. a penalty-only repayment on the loan (marked as taken from savings), so the loan's penalty owed goes down and a
--      loan whose instalments are all paid closes once its penalty is cleared.
-- The job has no signed-in user, so the deduction and journal have no "recorded by" person; screens show them as
-- automatic. Re-runnable: safe to paste into the SQL Editor more than once.

-- ---------------------------------------------------------------------------
-- Plan deductions
-- ---------------------------------------------------------------------------

alter type public.contribution_kind add value if not exists 'loan_penalty';

-- New enum values can't be used as literals in the transaction that adds them, so these compare as text.
alter table public.contributions drop constraint if exists contributions_sign;
alter table public.contributions add constraint contributions_sign check (
  (kind::text in ('reversal', 'loan_penalty') and amount < 0) or (kind::text not in ('reversal', 'loan_penalty') and amount > 0)
);
alter table public.contributions drop constraint if exists contributions_payment_method_check;
alter table public.contributions add constraint contributions_payment_method_check
  check (payment_method in ('bank_transfer', 'cash', 'pos', 'cheque', 'savings_deduction'));
alter table public.contributions drop constraint if exists contributions_deduction_method;
alter table public.contributions add constraint contributions_deduction_method
  check ((kind::text = 'loan_penalty') = (payment_method = 'savings_deduction'));
-- Automatic deductions have no person behind them.
alter table public.contributions alter column recorded_by drop not null;

-- Unchanged, except that a loan late fee deduction is written only by the daily job and arrives already verified.
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
  if new.kind::text = 'loan_penalty' then
    new.verified_at := now();
  else
    new.verified_at := null;
  end if;

  if new.kind = 'reversal' then
    select * into v_original from public.contributions where id = new.reverses_id;
    if v_original.member_plan_id is distinct from new.member_plan_id then
      raise exception 'a reversal must be on the same plan as the entry it reverses' using errcode = 'check_violation';
    end if;
    if v_original.kind = 'reversal' or v_original.kind::text = 'loan_penalty' then
      raise exception 'a reversal can''t itself be reversed, and a late fee deduction isn''t reversed here' using errcode = 'check_violation';
    end if;
    if new.amount <> -v_original.amount then
      raise exception 'a reversal must be for exactly the original amount' using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

-- Deductions are already in the ledger (the journal below), so Accounts doesn't post them as receipts or payments.
create or replace view public.contributions_awaiting_posting with (security_invoker = true) as
select c.id, c.member_id, c.member_plan_id, c.branch_id, c.kind, c.amount, c.paid_on, c.payment_method, c.reference,
       c.verified_at, concat_ws(' ', m.first_name, m.middle_name, m.last_name) as member_name, m.membership_no
from public.contributions c
join public.members m on m.id = c.member_id
where c.verified_at is not null
  and c.kind::text <> 'loan_penalty'
  and not exists (
    select 1 from public.finance_transactions t where t.contribution_id = c.id and t.status <> 'rejected'
  );
grant select on public.contributions_awaiting_posting to authenticated;

-- ---------------------------------------------------------------------------
-- Journal and loan repayment
-- ---------------------------------------------------------------------------

alter table public.journal_entries drop constraint if exists journal_entries_source_check;
alter table public.journal_entries
  add constraint journal_entries_source_check
  check (source in ('manual', 'transaction', 'reversal', 'bill', 'payroll', 'savings_recovery'));
alter table public.journal_entries alter column created_by drop not null;

-- A penalty taken from savings is a repayment with no Accounts receipt behind it.
alter table public.loan_repayments alter column finance_transaction_id drop not null;
alter table public.loan_repayments add column if not exists source text not null default 'receipt';
alter table public.loan_repayments drop constraint if exists loan_repayments_source;
alter table public.loan_repayments add constraint loan_repayments_source check (
  (source = 'receipt' and finance_transaction_id is not null)
  or (source = 'savings' and finance_transaction_id is null and principal = 0 and interest = 0)
);

create sequence if not exists public.loan_penalty_recovery_no_seq;

create table if not exists public.loan_penalty_recoveries (
  id uuid primary key default gen_random_uuid(),
  recovery_no text not null unique,
  loan_id uuid not null references public.loans (id) on delete restrict,
  member_id uuid not null references public.members (id),
  member_plan_id uuid not null references public.member_plans (id) on delete restrict,
  branch_id uuid not null references public.branches (id),
  amount numeric(14, 2) not null check (amount > 0),
  recovered_on date not null,
  contribution_id uuid not null unique references public.contributions (id),
  journal_entry_id uuid not null unique references public.journal_entries (id),
  loan_repayment_id uuid not null unique references public.loan_repayments (id),
  created_at timestamptz not null default now()
);
create index if not exists loan_penalty_recoveries_loan_idx on public.loan_penalty_recoveries (loan_id);
create index if not exists loan_penalty_recoveries_plan_idx on public.loan_penalty_recoveries (member_plan_id);
create index if not exists loan_penalty_recoveries_date_idx on public.loan_penalty_recoveries (recovered_on);

create or replace function app.loan_penalty_recoveries_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not app.in_workflow() or tg_op <> 'INSERT' then
    raise exception 'late fees taken from savings are recorded only by the daily job' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

drop trigger if exists loan_penalty_recoveries_guard on public.loan_penalty_recoveries;
create trigger loan_penalty_recoveries_guard
  before insert or update or delete on public.loan_penalty_recoveries
  for each row execute function app.loan_penalty_recoveries_guard();

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'audit_log_changes' and tgrelid = 'public.loan_penalty_recoveries'::regclass) then
    perform app.enable_audit('public.loan_penalty_recoveries');
  end if;
end;
$$;

alter table public.loan_penalty_recoveries enable row level security;
drop policy if exists "credit, member and finance staff read late fees from savings" on public.loan_penalty_recoveries;
create policy "credit, member and finance staff read late fees from savings" on public.loan_penalty_recoveries
  for select to authenticated
  using (
    app.has_branch_permission('credit.read', branch_id)
    or app.has_branch_permission('members.read', branch_id)
    or app.has_branch_permission('accounts.read', branch_id)
  );

-- ---------------------------------------------------------------------------
-- The daily job
-- ---------------------------------------------------------------------------

-- Takes every active loan's unpaid late penalty, as at p_as_of, from the borrower's savings. Returns how many
-- deductions it made. Runs as the owner; nobody signed in can call it.
create or replace function app.recover_loan_penalties_from_savings(p_as_of date default current_date)
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
  v_left numeric;
  v_no text;
  v_contribution_id uuid;
  v_entry_id uuid;
  v_repayment_id uuid;
  v_count integer := 0;
begin
  if p_as_of is null or p_as_of > current_date then
    raise exception 'late fees can''t be taken for a future date' using errcode = 'check_violation';
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
    select greatest(0, app.loan_penalty_accrued(v_loan.id, p_as_of) - coalesce(sum(r.penalty), 0))
      into v_owed
    from public.loan_repayments r
    where r.loan_id = v_loan.id and r.schedule_version = v_loan.schedule_version and r.reversed_at is null;
    v_owed := round(coalesce(v_owed, 0), 2);
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

      v_no := 'LFS-' || lpad(nextval('public.loan_penalty_recovery_no_seq')::text, 6, '0');

      insert into public.contributions (member_plan_id, member_id, branch_id, kind, amount, paid_on, payment_method, reference, notes)
      values (v_plan.id, v_plan.member_id, v_plan.branch_id, 'loan_penalty', -v_take, p_as_of, 'savings_deduction', v_no,
              'Late fee on loan ' || v_loan.loan_no || ' taken from savings')
      returning id into v_contribution_id;

      insert into public.journal_entries (branch_id, entry_date, description, source, status, created_by, posted_by, posted_at)
      values (v_plan.branch_id, p_as_of, v_no || ' Late fee on loan ' || v_loan.loan_no || ' taken from savings',
              'savings_recovery', 'draft', null, null, now())
      returning id into v_entry_id;
      insert into public.journal_lines (entry_id, line_no, account_code, debit, member_id, plan_type, description)
      values (v_entry_id, 1, '2110', v_take, v_loan.member_id, v_plan.plan_type, 'Late fee taken from savings');
      insert into public.journal_lines (entry_id, line_no, account_code, credit, member_id, description)
      values (v_entry_id, 2, '4150', v_take, v_loan.member_id, 'Late repayment penalty, loan ' || v_loan.loan_no);
      perform app.assert_balanced(v_entry_id);
      update public.journal_entries set status = 'posted' where id = v_entry_id;

      insert into public.loan_repayments
        (loan_id, branch_id, finance_transaction_id, txn_no, paid_on, amount, principal, interest, penalty, schedule_version, source)
      values (v_loan.id, v_loan.branch_id, null, v_no, p_as_of, v_take, 0, 0, v_take, v_loan.schedule_version, 'savings')
      returning id into v_repayment_id;

      insert into public.loan_penalty_recoveries
        (recovery_no, loan_id, member_id, member_plan_id, branch_id, amount, recovered_on, contribution_id, journal_entry_id,
         loan_repayment_id)
      values (v_no, v_loan.id, v_loan.member_id, v_plan.id, v_plan.branch_id, v_take, p_as_of, v_contribution_id, v_entry_id,
              v_repayment_id);

      v_owed := v_owed - v_take;
      v_count := v_count + 1;
    end loop;

    -- A loan whose instalments were already paid closes once its penalty is cleared, as with a receipt.
    select coalesce(sum(s.outstanding), 0) into v_left from public.loan_schedule_status s where s.loan_id = v_loan.id;
    if v_left = 0 and v_owed <= 0 then
      update public.loans set status = 'closed', closed_on = p_as_of where id = v_loan.id;
    end if;
  end loop;

  if not v_was_on then
    perform app.end_workflow();
  end if;
  return v_count;
end;
$$;
revoke all on function app.recover_loan_penalties_from_savings(date) from public, anon, authenticated;

-- Run it every day at 01:00 UTC (02:00 in Lagos) where pg_cron is available, as it is on Supabase. Scheduling a job
-- under the same name again replaces it.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
    perform cron.schedule('loan-late-fees-from-savings', '0 1 * * *',
                          'select app.recover_loan_penalties_from_savings()');
  end if;
end;
$$;
