-- Credit changes asked for on 2026-11-12/13:
--
--   1. A landmark beside the customer's address on a loan application ("opposite First Bank", "behind the market").
--   2. Restructuring is the Head of Credit's call (credit.approve), and the Head of Business (credit.business_approve)
--      must approve it before the new schedule takes effect. Account officers no longer request restructures.
--   3. Late repayment penalty. When an instalment falls due and isn't paid, what the customer owes grows by a percentage
--      of the unpaid instalment for every day it stays unpaid. The daily rate is set per loan product (Credit > Loan
--      products). Kuun hasn't given the rate yet, so every product starts at a PLACEHOLDER of 0.1% a day.
--
-- How the penalty works
--   * Each day an instalment is overdue, it is charged rate% of what is still unpaid on it (principal + interest; the
--     penalty itself is not charged penalty). Day one is the day after the due date. A repayment dated D stops the
--     charge from the day after D, so paying one day late costs one day.
--   * The penalty is worked out from the schedule and the posted repayments, not stored day by day, so it is always
--     up to date without a nightly job, and reversing a repayment in Accounts puts back exactly the penalty it stopped.
--   * A repayment pays, in order: the overdue instalments (interest then principal, oldest first), then the penalty,
--     then the instalments not yet due. Accounts posts the penalty part to 4150 Loan penalty income.
--   * A loan closes only when the schedule and the penalty are both paid.
--   * A restructure carries any unpaid penalty into the new schedule's first instalment, with the unpaid interest.

-- ---------------------------------------------------------------------------
-- 1. Landmark
-- ---------------------------------------------------------------------------

alter table public.loans
  add column address_landmark text check (address_landmark is null or length(address_landmark) <= 200);

-- ---------------------------------------------------------------------------
-- 2. Restructures: Head of Credit requests, Head of Business approves
-- ---------------------------------------------------------------------------

update public.permissions set description = 'Prepare loan applications, upload documents and record reminders'
 where code = 'credit.manage';
update public.permissions
   set description = 'Approve, return, reject or cancel loans, restructure loans and reassign account officers'
 where code = 'credit.approve';
update public.permissions set description = 'Give the final approval on loans and loan restructures'
 where code = 'credit.business_approve';
update public.roles set description = 'Approves or rejects loans, restructures loans and owns the loan products'
 where code = 'credit_manager';
update public.roles
   set description = 'Gives the final approval on loans and loan restructures after the Head of Credit, before they take effect'
 where code = 'head_of_business';

alter table public.loan_restructures
  add column carried_penalty numeric(14, 2);

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
  if not found or not app.has_branch_permission('credit.read', v_loan.branch_id) then
    raise exception 'loan not found' using errcode = 'no_data_found';
  end if;
  if not app.has_branch_permission('credit.approve', v_loan.branch_id) then
    raise exception 'only the Head of Credit can restructure a loan' using errcode = 'insufficient_privilege';
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

-- ---------------------------------------------------------------------------
-- 3. Late repayment penalty
-- ---------------------------------------------------------------------------

-- PLACEHOLDER rate: 0.1% a day until Kuun gives the real one. Change it per product on Credit > Loan products.
alter table public.loan_products
  add column late_penalty_rate numeric(7, 4) not null default 0.1 check (late_penalty_rate >= 0 and late_penalty_rate <= 10);
comment on column public.loan_products.late_penalty_rate is
  'Percent of an overdue instalment''s unpaid amount added to what the customer owes for each day it stays unpaid. 0.1 is a placeholder.';

alter table public.loan_repayments
  add column penalty numeric(14, 2) not null default 0 check (penalty >= 0);
alter table public.loan_repayments drop constraint loan_repayments_split;
alter table public.loan_repayments add constraint loan_repayments_split check (principal + interest + penalty = amount);

alter table public.finance_transactions
  add column penalty_amount numeric(14, 2) not null default 0 check (penalty_amount >= 0);
alter table public.finance_transactions
  add constraint finance_transactions_penalty check (interest_amount + penalty_amount <= amount);

insert into public.ledger_accounts (code, name, account_type, parent_code, is_group, cash_flow_class, description)
values ('4150', 'Loan penalty income', 'income', '4000', false, 'operating', 'Late repayment penalties charged on overdue loan instalments')
on conflict (code) do nothing;

alter table public.posting_rules
  add column penalty_account text references public.ledger_accounts (code);
update public.posting_rules set penalty_account = '4150', name = 'Loan repayment (principal, interest and penalty)'
 where transaction_type = 'loan_repayment';

-- The penalty a loan's current schedule has run up to the end of p_as_of. Runs with the caller's rights, so a reader
-- only gets figures for loans they can see; the Accounts triggers call it with the owner's rights.
create or replace function app.loan_penalty_accrued(p_loan_id uuid, p_as_of date)
returns numeric
language plpgsql
stable
set search_path = ''
as $$
declare
  v_loan public.loans;
  v_rate numeric;
  v_total numeric := 0;
  v_prev date := null;
  v_paid_p numeric := 0;
  v_paid_i numeric := 0;
  v_pay record;
begin
  select * into v_loan from public.loans where id = p_loan_id;
  if not found or v_loan.schedule_version = 0 or p_as_of is null then
    return 0;
  end if;
  select late_penalty_rate into v_rate from public.loan_products where code = v_loan.product_code;
  if coalesce(v_rate, 0) = 0 then
    return 0;
  end if;

  -- Between two repayment dates what is paid is fixed, so each instalment's unpaid amount is too: charge it for its
  -- overdue days in that stretch. A stretch (v_prev, d] uses the repayments dated on or before v_prev.
  for v_pay in
    select r.paid_on, sum(r.principal) as principal, sum(r.interest) as interest
    from public.loan_repayments r
    where r.loan_id = p_loan_id and r.schedule_version = v_loan.schedule_version and r.reversed_at is null
      and r.paid_on < p_as_of
    group by r.paid_on
    order by r.paid_on
  loop
    v_total := v_total + app.loan_penalty_stretch(p_loan_id, v_loan.schedule_version, v_paid_p, v_paid_i, v_prev, v_pay.paid_on);
    v_paid_p := v_paid_p + v_pay.principal;
    v_paid_i := v_paid_i + v_pay.interest;
    v_prev := v_pay.paid_on;
  end loop;
  v_total := v_total + app.loan_penalty_stretch(p_loan_id, v_loan.schedule_version, v_paid_p, v_paid_i, v_prev, p_as_of);
  return round(v_total * v_rate / 100, 2);
end;
$$;

-- Sum over instalments of (unpaid amount × overdue days in (p_from, p_to]), given what had been paid in that stretch.
-- Payments fill instalments in order, interest and principal separately, the same way loan_schedule_status does.
create or replace function app.loan_penalty_stretch(
  p_loan_id uuid, p_version integer, p_paid_principal numeric, p_paid_interest numeric, p_from date, p_to date
)
returns numeric
language sql
stable
set search_path = ''
as $$
  with inst as (
    select i.due_date, i.principal_due, i.interest_due,
           sum(i.principal_due) over w - i.principal_due as principal_before,
           sum(i.interest_due) over w - i.interest_due as interest_before
    from public.loan_installments i
    where i.loan_id = p_loan_id and i.schedule_version = p_version and i.due_date < p_to
    window w as (order by i.installment_no rows between unbounded preceding and current row)
  )
  select coalesce(sum(
    (principal_due - greatest(0, least(principal_due, p_paid_principal - principal_before))
     + interest_due - greatest(0, least(interest_due, p_paid_interest - interest_before)))
    * greatest(0, p_to - greatest(coalesce(p_from, due_date), due_date))
  ), 0)
  from inst;
$$;

grant execute on function app.loan_penalty_accrued(uuid, date) to authenticated;
grant execute on function app.loan_penalty_stretch(uuid, integer, numeric, numeric, date, date) to authenticated;

-- Splits a payment made on p_as_of: overdue instalments first (interest before principal, oldest first), then the
-- penalty owed, then the instalments not yet due. p_paid_* are what the current schedule has already received.
-- Raises if the payment is more than what is owed.
drop function app.loan_allocate(uuid, numeric, numeric, numeric);
create or replace function app.loan_allocate(
  p_loan_id uuid, p_amount numeric, p_paid_principal numeric, p_paid_interest numeric, p_paid_penalty numeric, p_as_of date
)
returns table (principal numeric, interest numeric, penalty numeric)
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
  v_penalty_owed numeric;
  v_penalty_done boolean := false;
  v_take numeric;
  v_rem numeric;
begin
  principal := 0;
  interest := 0;
  penalty := 0;
  v_penalty_owed := greatest(0, app.loan_penalty_accrued(p_loan_id, p_as_of) - coalesce(p_paid_penalty, 0));
  for v_inst in
    select i.principal_due, i.interest_due, i.due_date
    from public.loan_installments i
    join public.loans l on l.id = i.loan_id and l.schedule_version = i.schedule_version
    where i.loan_id = p_loan_id
    order by i.installment_no
  loop
    if not v_penalty_done and v_inst.due_date >= p_as_of then
      v_owed := v_owed + v_penalty_owed;
      penalty := least(v_left, v_penalty_owed);
      v_left := v_left - penalty;
      v_penalty_done := true;
    end if;

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
  if not v_penalty_done then
    v_owed := v_owed + v_penalty_owed;
    penalty := least(v_left, v_penalty_owed);
    v_left := v_left - penalty;
  end if;
  if v_left > 0 then
    raise exception 'that is more than the ₦% still owed on this loan', to_char(v_owed, 'FM999,999,999,990.00')
      using errcode = 'check_violation';
  end if;
  return next;
end;
$$;
revoke all on function app.loan_allocate(uuid, numeric, numeric, numeric, numeric, date) from public, anon, authenticated;

-- Unchanged, except that the database also works out the penalty part of a repayment.
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
  v_paid_pen numeric;
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
    new.penalty_amount := 0;
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
    new.penalty_amount := 0;
    return new;
  end if;

  -- Repayment: the database works out the interest and penalty, after any earlier repayments still being processed.
  if v_loan.status <> 'active' then
    raise exception 'repayments are recorded against active loans' using errcode = 'check_violation';
  end if;
  select coalesce(sum(r.principal), 0), coalesce(sum(r.interest), 0), coalesce(sum(r.penalty), 0)
    into v_paid_p, v_paid_i, v_paid_pen
  from public.loan_repayments r
  where r.loan_id = v_loan.id and r.schedule_version = v_loan.schedule_version and r.reversed_at is null;
  select v_paid_p + coalesce(sum(t.amount - t.interest_amount - t.penalty_amount), 0), v_paid_i + coalesce(sum(t.interest_amount), 0),
         v_paid_pen + coalesce(sum(t.penalty_amount), 0)
    into v_paid_p, v_paid_i, v_paid_pen
  from public.finance_transactions t
  where t.loan_id = v_loan.id and t.transaction_type = 'loan_repayment' and t.id <> new.id
    and t.status in ('draft', 'submitted', 'returned', 'approved')
    and t.created_at < coalesce(new.created_at, now());
  select * into v_split from app.loan_allocate(v_loan.id, new.amount, v_paid_p, v_paid_i, v_paid_pen, new.txn_date);
  new.interest_amount := v_split.interest;
  new.penalty_amount := v_split.penalty;
  return new;
end;
$$;

-- Unchanged, except that posting records the penalty part and a loan closes only when its penalty is paid too.
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
  v_paid_pen numeric;
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
    select coalesce(sum(r.principal), 0), coalesce(sum(r.interest), 0), coalesce(sum(r.penalty), 0)
      into v_paid_p, v_paid_i, v_paid_pen
    from public.loan_repayments r
    where r.loan_id = v_loan.id and r.schedule_version = v_loan.schedule_version and r.reversed_at is null;
    select * into v_split from app.loan_allocate(v_loan.id, new.amount, v_paid_p, v_paid_i, v_paid_pen, new.txn_date);
    if v_split.interest <> new.interest_amount or v_split.penalty <> new.penalty_amount then
      raise exception 'other repayments on this loan were posted first, so this one''s interest and penalty split has changed; return it so it can be saved again'
        using errcode = 'check_violation';
    end if;
    insert into public.loan_repayments
      (loan_id, branch_id, finance_transaction_id, txn_no, paid_on, amount, principal, interest, penalty, schedule_version)
    values (v_loan.id, v_loan.branch_id, new.id, new.txn_no, new.txn_date, new.amount,
            new.amount - new.interest_amount - new.penalty_amount, new.interest_amount, new.penalty_amount, v_loan.schedule_version);
    select coalesce(sum(s.outstanding), 0) into v_left from public.loan_schedule_status s where s.loan_id = v_loan.id;
    select v_left + greatest(0, app.loan_penalty_accrued(v_loan.id, greatest(current_date, new.txn_date)) - coalesce(sum(r.penalty), 0))
      into v_left
    from public.loan_repayments r
    where r.loan_id = v_loan.id and r.schedule_version = v_loan.schedule_version and r.reversed_at is null;
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

-- Unchanged, except that the penalty part of a loan repayment goes to the penalty income account.
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
    if v_txn.amount - v_txn.interest_amount - v_txn.penalty_amount > 0 then
      insert into public.journal_lines (entry_id, line_no, account_code, credit, member_id, description)
      values (v_entry_id, 2, v_rule.credit_account, v_txn.amount - v_txn.interest_amount - v_txn.penalty_amount, v_txn.member_id,
              v_txn.description);
    end if;
    if v_txn.interest_amount > 0 then
      insert into public.journal_lines (entry_id, line_no, account_code, credit, member_id, description)
      values (v_entry_id, 3, v_rule.interest_account, v_txn.interest_amount, v_txn.member_id, 'Interest');
    end if;
    if v_txn.penalty_amount > 0 then
      insert into public.journal_lines (entry_id, line_no, account_code, credit, member_id, description)
      values (v_entry_id, 4, coalesce(v_rule.penalty_account, v_rule.interest_account), v_txn.penalty_amount, v_txn.member_id,
              'Late repayment penalty');
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

-- The Head of Business's decision on a restructure the Head of Credit asked for. On approval, the principal still owed,
-- plus interest already due and unpaid and any unpaid penalty, gets a new schedule on the new terms.
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
  v_penalty numeric;
  v_maturity date;
begin
  select * into v_row from public.loan_restructures where id = p_id for update;
  if not found or not app.has_branch_permission('credit.read', v_row.branch_id) then
    raise exception 'restructure not found' using errcode = 'no_data_found';
  end if;
  if not app.has_branch_permission('credit.business_approve', v_row.branch_id) then
    raise exception 'only the Head of Business can approve a restructure' using errcode = 'insufficient_privilege';
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
  select greatest(0, app.loan_penalty_accrued(v_loan.id, current_date) - coalesce(sum(r.penalty), 0)) into v_penalty
  from public.loan_repayments r
  where r.loan_id = v_loan.id and r.schedule_version = v_loan.schedule_version and r.reversed_at is null;

  perform app.begin_workflow();
  update public.loans
     set tenor_months = v_row.tenor_months, repayment_frequency = v_row.repayment_frequency, interest_rate = v_row.interest_rate,
         rate_basis = v_row.rate_basis, interest_method = v_row.interest_method, first_repayment_date = v_row.first_repayment_date,
         schedule_version = v_loan.schedule_version + 1
   where id = v_loan.id
   returning * into v_loan;
  v_maturity := app.write_loan_schedule(v_loan, v_loan.schedule_version, v_principal, current_date, v_row.first_repayment_date,
                                        v_carried + v_penalty);
  update public.loans set maturity_date = v_maturity where id = v_loan.id;
  update public.loan_restructures
     set status = 'approved', decided_by = auth.uid(), decided_at = now(), decision_note = nullif(trim(p_note), ''),
         outstanding_principal = v_principal, carried_interest = v_carried, carried_penalty = v_penalty,
         from_version = v_loan.schedule_version - 1, to_version = v_loan.schedule_version
   where id = p_id
   returning * into v_row;
  perform app.end_workflow();
  return v_row;
end;
$$;

-- The loan book, with the penalty added at the end: what the current schedule has run up, what has been paid towards
-- penalties (all schedules), what is still owed, and the product's daily rate.
create or replace view public.loan_book with (security_invoker = true) as
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
       r.last_paid_on,
       p.late_penalty_rate,
       coalesce(r.penalty, 0)::numeric(16, 2) as penalty_repaid,
       pen.outstanding::numeric(16, 2) as penalty_outstanding
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
  select sum(rp.principal) as principal, sum(rp.interest) as interest, sum(rp.penalty) as penalty, max(rp.paid_on) as last_paid_on,
         sum(rp.penalty) filter (where rp.schedule_version = l.schedule_version) as penalty_this_schedule
  from public.loan_repayments rp
  where rp.loan_id = l.id and rp.reversed_at is null
) r on true
left join lateral (
  -- Only an active loan can owe a penalty: a closed one paid it before closing.
  select case when l.status = 'active'
              then greatest(0, app.loan_penalty_accrued(l.id, current_date) - coalesce(r.penalty_this_schedule, 0))
              else 0 end as outstanding
) pen on true;
grant select on public.loan_book to authenticated;
