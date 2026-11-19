-- Interest payment requests are raised automatically (sosa, 2026-11-19: "automatically, but can be audited and
-- reviewed").
--
-- Every morning a job reads the day's interest payment schedule and raises one "ROI paid to member" payment request
-- per member due, from the member's branch bank account. A request is a draft with no preparer ("raised
-- automatically"); it then goes through the usual chain: an accountant with accounts.payments.request reviews it and
-- submits it (they may correct it first), Accounts approves it, Internal Audit approves it, and it is paid with proof.
-- The schedule is the supporting evidence, so no attachment is needed to submit it.
-- A member is never raised twice for the same pay date. Re-runnable: safe to paste into the SQL Editor more than once.

alter table public.finance_transactions alter column created_by drop not null;
alter table public.finance_transactions add column if not exists interest_for date;
comment on column public.finance_transactions.interest_for is
  'Set on interest payment requests raised automatically from the interest payment schedule: the pay date.';
create unique index if not exists finance_transactions_interest_for_idx
  on public.finance_transactions (member_id, interest_for)
  where interest_for is not null and status <> 'rejected';

-- Accounts can correct a request the job raised before submitting it, as they would their own.
drop policy if exists "accounts edit automatic interest requests" on public.finance_transactions;
create policy "accounts edit automatic interest requests" on public.finance_transactions for update to authenticated
  using (status in ('draft', 'returned') and created_by is null and interest_for is not null
         and app.has_branch_permission('accounts.payments.request', branch_id))
  with check (created_by is null and interest_for is not null
              and app.has_branch_permission('accounts.payments.request', branch_id));

-- Unchanged, except that an automatic interest request needs no attachment: the schedule is its evidence.
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
     and v_txn.liquidation_id is null
     and v_txn.interest_for is null
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

-- Raises the interest payment requests due on p_date. Returns how many it raised. A member whose branch has no active
-- bank account is skipped (and shows on the schedule as before). Runs as the owner; nobody signed in can call it.
create or replace function app.raise_interest_payment_requests(p_date date default current_date)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_bank uuid;
  v_count integer := 0;
begin
  if p_date is null or p_date > current_date then
    raise exception 'interest can''t be raised for a future date' using errcode = 'check_violation';
  end if;
  for v_row in select * from public.interest_payment_schedule(p_date) s where s.amount > 0 loop
    continue when exists (
      select 1 from public.finance_transactions t
      where t.member_id = v_row.member_id and t.interest_for = p_date and t.status <> 'rejected'
    );
    select b.id into v_bank from public.bank_accounts b
    where b.branch_id = v_row.branch_id and b.is_active and b.kind = 'bank'
    order by b.created_at limit 1;
    continue when v_bank is null;

    insert into public.finance_transactions
      (direction, transaction_type, txn_date, amount, bank_account_id, member_id, counterparty, description, interest_for)
    values
      ('payment', 'roi_payment', p_date, v_row.amount, v_bank, v_row.member_id, v_row.beneficiary_name,
       'Monthly interest for ' || to_char(p_date, 'FMMonth YYYY') || ' (pay day ' || to_char(p_date, 'FMDD') || ')', p_date);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
revoke all on function app.raise_interest_payment_requests(date) from public, anon, authenticated;

-- Every morning at 05:00 UTC (06:00 in Lagos), where pg_cron is available, as it is on Supabase.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
    perform cron.schedule('interest-payment-requests', '0 5 * * *', 'select app.raise_interest_payment_requests()');
  end if;
end;
$$;
