-- Roll-over at maturity (sosa, 2026-11-19: "earned dividend paid monthly and capital rolled over. Target savings:
-- client chooses roll over capital only or roll over capital plus earnings").
--
-- When a plan has matured, Operations can ask to roll it over instead of liquidating it, choosing the new tenure. The
-- Branch Manager (someone other than the officer) approves it, and then:
--   * the plan's verified savings (the capital) move into a new plan of the same type that starts on the old plan's
--     maturity date, as verified "Moved between plans" entries. No cash moves and it stays in Member savings (2110), so
--     there is no journal. The old plan closes as matured. The new plan keeps the interest pay day and starts at the
--     plan type's rate (a special rate needs asking for again).
--   * Plans paying monthly: their dividends were paid monthly, so only the capital rolls over.
--   * Target savings, where the dividends build up to maturity, the member chooses:
--       - capital plus earnings: the dividends earned to maturity join the capital in the new plan, and a journal
--         Dr 2140 ROI payable / Cr 2110 Member savings is prepared for the Receipts Confirmation Accountant to post
--         (only they credit a member's account);
--       - capital only: the dividends are raised as an "ROI paid to member" payment request (no preparer, like the
--         automatic interest requests) for Accounts to review and pay through the usual chain.
-- The agreement letter for the new plan can be printed worded as a roll-over.
-- Run after 20261119000100 (and after 20261119000040 if that is used). Re-runnable.

alter type public.contribution_kind add value if not exists 'plan_transfer';

alter table public.journal_entries drop constraint if exists journal_entries_source_check;
alter table public.journal_entries add constraint journal_entries_source_check
  check (source in ('manual', 'transaction', 'reversal', 'bill', 'payroll', 'savings_recovery', 'rollover'));

insert into public.permissions (code, description) values
  ('plans.rollover.request', 'Ask to roll a matured plan over into a new plan'),
  ('plans.rollover.approve', 'Approve rolling a matured plan over')
on conflict (code) do update set description = excluded.description;

insert into public.role_permissions (role_code, permission_code) values
  ('admin_officer', 'plans.rollover.request'),
  ('branch_manager', 'plans.rollover.approve')
on conflict do nothing;

create sequence if not exists public.plan_rollover_no_seq;

create table if not exists public.plan_rollovers (
  id uuid primary key default gen_random_uuid(),
  rollover_no text not null unique,
  member_plan_id uuid not null references public.member_plans (id) on delete restrict,
  member_id uuid not null references public.members (id),
  branch_id uuid not null references public.branches (id),
  tenure_months integer not null check (tenure_months between 1 and 120),
  -- Target savings only: true = capital plus earnings, false = capital only (earnings paid out).
  include_earnings boolean not null default false,
  note text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined', 'cancelled')),
  requested_by uuid not null references public.staff (id),
  requested_at timestamptz not null default now(),
  decided_by uuid references public.staff (id),
  decided_at timestamptz,
  decision_note text,
  -- Filled in when approved.
  capital numeric(16, 2),
  earnings numeric(16, 2),
  new_plan_id uuid references public.member_plans (id),
  journal_entry_id uuid references public.journal_entries (id),
  payout_txn_id uuid references public.finance_transactions (id)
);
create index if not exists plan_rollovers_plan_idx on public.plan_rollovers (member_plan_id);
create unique index if not exists plan_rollovers_one_open_idx on public.plan_rollovers (member_plan_id) where status in ('pending', 'approved');

alter table public.member_plans add column if not exists rolled_over_from uuid references public.member_plans (id);
alter table public.finance_transactions add column if not exists plan_rollover_id uuid references public.plan_rollovers (id);

drop trigger if exists plan_rollovers_guard on public.plan_rollovers;
create trigger plan_rollovers_guard before insert or update or delete on public.plan_rollovers
  for each row execute function app.plan_rate_requests_guard();

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'audit_log_changes' and tgrelid = 'public.plan_rollovers'::regclass) then
    perform app.enable_audit('public.plan_rollovers');
  end if;
end;
$$;

alter table public.plan_rollovers enable row level security;
drop policy if exists "member readers see roll-overs" on public.plan_rollovers;
create policy "member readers see roll-overs" on public.plan_rollovers for select to authenticated
  using (app.has_branch_permission('members.read', branch_id));

-- Accounts can correct the earnings payout a roll-over raised before submitting it, as with automatic interest.
drop policy if exists "accounts edit automatic interest requests" on public.finance_transactions;
create policy "accounts edit automatic interest requests" on public.finance_transactions for update to authenticated
  using (status in ('draft', 'returned') and created_by is null and (interest_for is not null or plan_rollover_id is not null)
         and app.has_branch_permission('accounts.payments.request', branch_id))
  with check (created_by is null and (interest_for is not null or plan_rollover_id is not null)
              and app.has_branch_permission('accounts.payments.request', branch_id));

-- Unchanged from 20261119000120, except that a roll-over's earnings payout needs no attachment either.
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
     and v_txn.plan_rollover_id is null
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

-- Checks a plan can be rolled over now; returns it locked.
create or replace function app.plan_rollover_check(p_plan_id uuid)
returns public.member_plans
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan public.member_plans;
begin
  select * into v_plan from public.member_plans where id = p_plan_id for update;
  if not found or not app.has_branch_permission('members.read', v_plan.branch_id) then
    raise exception 'plan not found' using errcode = 'no_data_found';
  end if;
  if v_plan.status not in ('active', 'matured') or v_plan.closed_at is not null then
    raise exception 'only an open plan can be rolled over' using errcode = 'check_violation';
  end if;
  if v_plan.maturity_date > current_date then
    raise exception 'the plan matures on %: roll it over from then', to_char(v_plan.maturity_date, 'FMDD Mon YYYY')
      using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.contributions c where c.member_plan_id = p_plan_id and c.verified_at is null) then
    raise exception 'verify or reverse the plan''s unverified contributions first' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.plan_liquidations q
             where q.member_plan_id = p_plan_id and q.status in ('pending_approval', 'returned', 'approved')) then
    raise exception 'this plan has a liquidation in progress' using errcode = 'check_violation';
  end if;
  if (select coalesce(sum(c.amount), 0) from public.contributions c where c.member_plan_id = p_plan_id and c.verified_at is not null) <= 0 then
    raise exception 'there are no savings on this plan to roll over' using errcode = 'check_violation';
  end if;
  return v_plan;
end;
$$;
revoke all on function app.plan_rollover_check(uuid) from public, anon, authenticated;

create or replace function public.request_plan_rollover(p_plan_id uuid, p_tenure_months integer, p_include_earnings boolean, p_note text)
returns public.plan_rollovers
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_was_on boolean := app.in_workflow();
  v_plan public.member_plans;
  v_type public.plan_types;
  v_row public.plan_rollovers;
begin
  v_plan := app.plan_rollover_check(p_plan_id);
  if not app.has_branch_permission('plans.rollover.request', v_plan.branch_id) then
    raise exception 'only an Operations officer can ask for a roll-over' using errcode = 'insufficient_privilege';
  end if;
  select * into v_type from public.plan_types where code = v_plan.plan_type;
  if p_tenure_months is null or p_tenure_months < 1 or p_tenure_months > 120 then
    raise exception 'choose the new tenure in months' using errcode = 'check_violation';
  end if;
  if v_type.tenure_months is not null and not (p_tenure_months = any (v_type.tenure_months)) then
    raise exception '% runs for % months', v_type.name, array_to_string(v_type.tenure_months, ', ') using errcode = 'check_violation';
  end if;
  if coalesce(p_include_earnings, false) and not v_plan.dividends_at_maturity then
    raise exception 'this plan''s dividends were paid monthly, so only the capital rolls over' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.plan_rollovers r where r.member_plan_id = p_plan_id and r.status = 'pending') then
    raise exception 'a roll-over for this plan is already waiting for approval' using errcode = 'check_violation';
  end if;

  perform app.begin_workflow();
  insert into public.plan_rollovers (rollover_no, member_plan_id, member_id, branch_id, tenure_months, include_earnings, note,
                                     status, requested_by)
  values ('ROLL-' || lpad(nextval('public.plan_rollover_no_seq')::text, 6, '0'), p_plan_id, v_plan.member_id, v_plan.branch_id,
          p_tenure_months, coalesce(p_include_earnings, false), nullif(trim(coalesce(p_note, '')), ''), 'pending', auth.uid())
  returning * into v_row;
  if not v_was_on then
    perform app.end_workflow();
  end if;
  return v_row;
end;
$$;
revoke all on function public.request_plan_rollover(uuid, integer, boolean, text) from public, anon;
grant execute on function public.request_plan_rollover(uuid, integer, boolean, text) to authenticated;

-- The Branch Manager approves (and the roll-over happens) or declines with a reason.
create or replace function public.decide_plan_rollover(p_id uuid, p_approve boolean, p_note text)
returns public.plan_rollovers
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_was_on boolean := app.in_workflow();
  v_row public.plan_rollovers;
  v_plan public.member_plans;
  v_capital numeric(16, 2);
  v_earnings numeric(16, 2) := 0;
  v_new_id uuid;
  v_entry_id uuid;
  v_txn_id uuid;
  v_bank uuid;
  v_name text;
begin
  select * into v_row from public.plan_rollovers where id = p_id for update;
  if not found or not app.has_branch_permission('plans.rollover.approve', v_row.branch_id) then
    raise exception 'roll-over not found' using errcode = 'no_data_found';
  end if;
  if v_row.status <> 'pending' then
    raise exception 'this roll-over is already %', v_row.status using errcode = 'check_violation';
  end if;
  if auth.uid() = v_row.requested_by then
    raise exception 'someone other than the officer who asked must approve the roll-over' using errcode = 'insufficient_privilege';
  end if;

  if not p_approve then
    if length(trim(coalesce(p_note, ''))) < 5 then
      raise exception 'give the reason for declining' using errcode = 'check_violation';
    end if;
    perform app.begin_workflow();
    update public.plan_rollovers
       set status = 'declined', decided_by = auth.uid(), decided_at = now(), decision_note = trim(p_note)
     where id = p_id returning * into v_row;
    if not v_was_on then
      perform app.end_workflow();
    end if;
    return v_row;
  end if;

  v_plan := app.plan_rollover_check(v_row.member_plan_id);
  select coalesce(sum(c.amount), 0) into v_capital
  from public.contributions c where c.member_plan_id = v_plan.id and c.verified_at is not null;
  if v_plan.dividends_at_maturity then
    v_earnings := public.plan_accrued_dividends(v_plan.id, v_plan.maturity_date);
  end if;
  select concat_ws(' ', m.first_name, m.middle_name, m.last_name) into v_name from public.members m where m.id = v_plan.member_id;

  perform app.begin_workflow();

  -- The new plan, from the old plan's maturity date, at the plan type's rate.
  insert into public.member_plans (member_id, branch_id, plan_type, contribution_amount, contribution_frequency, start_date,
                                   maturity_date, interest_pay_day)
  values (v_plan.member_id, v_plan.branch_id, v_plan.plan_type,
          v_capital + case when v_row.include_earnings then v_earnings else 0 end, 'one_off', v_plan.maturity_date,
          (v_plan.maturity_date + make_interval(months => v_row.tenure_months))::date, v_plan.interest_pay_day)
  returning id into v_new_id;
  update public.member_plans set rolled_over_from = v_plan.id where id = v_new_id;

  -- The capital moves across.
  insert into public.contributions (member_plan_id, member_id, branch_id, kind, amount, paid_on, payment_method, reference, notes)
  values (v_plan.id, v_plan.member_id, v_plan.branch_id, 'plan_transfer', -v_capital, v_plan.maturity_date, 'plan_transfer',
          v_row.rollover_no, 'Capital rolled over into a new plan');
  insert into public.contributions (member_plan_id, member_id, branch_id, kind, amount, paid_on, payment_method, reference, notes)
  values (v_new_id, v_plan.member_id, v_plan.branch_id, 'plan_transfer', v_capital, v_plan.maturity_date, 'plan_transfer',
          v_row.rollover_no, 'Capital rolled over from the matured plan');

  if v_earnings > 0 and v_row.include_earnings then
    -- Earnings join the capital: they become the member's savings.
    insert into public.contributions (member_plan_id, member_id, branch_id, kind, amount, paid_on, payment_method, reference, notes)
    values (v_new_id, v_plan.member_id, v_plan.branch_id, 'plan_transfer', v_earnings, v_plan.maturity_date, 'plan_transfer',
            v_row.rollover_no, 'Dividends earned on the matured plan, rolled over with the capital');
    insert into public.journal_entries (branch_id, entry_date, description, source, status, created_by, posted_by, posted_at)
    values (v_plan.branch_id, current_date, v_row.rollover_no || ' Target savings dividends rolled over with the capital for ' || v_name,
            'rollover', 'draft', auth.uid(), null, null)
    returning id into v_entry_id;
    insert into public.journal_lines (entry_id, line_no, account_code, debit, member_id, description)
    values (v_entry_id, 1, '2140', v_earnings, v_plan.member_id, 'Dividends due at maturity');
    insert into public.journal_lines (entry_id, line_no, account_code, credit, member_id, plan_type, description)
    values (v_entry_id, 2, '2110', v_earnings, v_plan.member_id, v_plan.plan_type, 'Dividends rolled into savings');
    -- Left as a draft: it credits the member, so the Receipts Confirmation Accountant posts it.
    perform app.assert_balanced(v_entry_id);
  elsif v_earnings > 0 then
    -- Capital only: the earnings are paid out through Accounts.
    select b.id into v_bank from public.bank_accounts b
    where b.branch_id = v_plan.branch_id and b.is_active and b.kind = 'bank'
    order by b.created_at limit 1;
    if v_bank is null then
      raise exception 'the branch has no bank account to pay the dividends from' using errcode = 'check_violation';
    end if;
    insert into public.finance_transactions
      (direction, transaction_type, txn_date, amount, bank_account_id, member_id, counterparty, description, plan_rollover_id)
    values ('payment', 'roi_payment', current_date, v_earnings, v_bank, v_plan.member_id, v_name,
            'Target savings dividends at maturity (' || v_row.rollover_no || ', capital rolled over)', v_row.id)
    returning id into v_txn_id;
    -- Raised by the system, not by the Branch Manager, so Accounts reviews and submits it.
    update public.finance_transactions set created_by = null where id = v_txn_id;
  end if;

  update public.member_plans set status = 'matured', closed_at = now() where id = v_plan.id;

  update public.plan_rollovers
     set status = 'approved', decided_by = auth.uid(), decided_at = now(), decision_note = nullif(trim(coalesce(p_note, '')), ''),
         capital = v_capital, earnings = v_earnings, new_plan_id = v_new_id, journal_entry_id = v_entry_id, payout_txn_id = v_txn_id
   where id = p_id returning * into v_row;

  if not v_was_on then
    perform app.end_workflow();
  end if;
  return v_row;
end;
$$;
revoke all on function public.decide_plan_rollover(uuid, boolean, text) from public, anon;
grant execute on function public.decide_plan_rollover(uuid, boolean, text) to authenticated;

create or replace function public.cancel_plan_rollover(p_id uuid, p_note text)
returns public.plan_rollovers
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_was_on boolean := app.in_workflow();
  v_row public.plan_rollovers;
begin
  select * into v_row from public.plan_rollovers where id = p_id for update;
  if not found or not app.has_branch_permission('plans.rollover.request', v_row.branch_id) then
    raise exception 'roll-over not found' using errcode = 'no_data_found';
  end if;
  if v_row.status <> 'pending' then
    raise exception 'this roll-over is already %', v_row.status using errcode = 'check_violation';
  end if;
  if length(trim(coalesce(p_note, ''))) < 5 then
    raise exception 'say why the roll-over is cancelled' using errcode = 'check_violation';
  end if;
  perform app.begin_workflow();
  update public.plan_rollovers
     set status = 'cancelled', decided_by = auth.uid(), decided_at = now(), decision_note = trim(p_note)
   where id = p_id returning * into v_row;
  if not v_was_on then
    perform app.end_workflow();
  end if;
  return v_row;
end;
$$;
revoke all on function public.cancel_plan_rollover(uuid, text) from public, anon;
grant execute on function public.cancel_plan_rollover(uuid, text) to authenticated;

-- Roll-overs the caller may see, with names and the amounts as they stand (or as they were when approved).
create or replace function public.plan_rollover_list()
returns table (
  id uuid, rollover_no text, branch_id uuid, branch_name text, member_id uuid, member_name text, membership_no text,
  member_plan_id uuid, plan_name text, maturity_date date, dividends_at_maturity boolean, tenure_months integer,
  include_earnings boolean, note text, status text, requested_by uuid, requested_by_name text, requested_at timestamptz,
  decided_by_name text, decided_at timestamptz, decision_note text, capital numeric, earnings numeric, new_plan_id uuid,
  payout_txn_no text
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.rollover_no, r.branch_id, b.name, r.member_id, concat_ws(' ', m.first_name, m.middle_name, m.last_name),
         m.membership_no, r.member_plan_id, t.name, p.maturity_date, p.dividends_at_maturity, r.tenure_months,
         r.include_earnings, r.note, r.status, r.requested_by, rs.full_name, r.requested_at, ds.full_name, r.decided_at,
         r.decision_note,
         coalesce(r.capital, (select coalesce(sum(c.amount), 0) from public.contributions c
                              where c.member_plan_id = p.id and c.verified_at is not null)),
         coalesce(r.earnings, case when p.dividends_at_maturity then public.plan_accrued_dividends(p.id, p.maturity_date) else 0 end),
         r.new_plan_id, ft.txn_no
  from public.plan_rollovers r
  join public.branches b on b.id = r.branch_id
  join public.members m on m.id = r.member_id
  join public.member_plans p on p.id = r.member_plan_id
  join public.plan_types t on t.code = p.plan_type
  join public.staff rs on rs.id = r.requested_by
  left join public.staff ds on ds.id = r.decided_by
  left join public.finance_transactions ft on ft.id = r.payout_txn_id
  where app.has_branch_permission('members.read', r.branch_id)
  order by r.requested_at desc;
$$;
revoke all on function public.plan_rollover_list() from public, anon;
grant execute on function public.plan_rollover_list() to authenticated;
