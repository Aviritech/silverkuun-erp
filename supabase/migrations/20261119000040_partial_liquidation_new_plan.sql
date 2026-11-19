-- Partial liquidation rolls the rest into a new plan (sosa, 2026-11-19: "if only part of the total contribution is
-- liquidated the entire contribution should be liquidated with the remaining part used for a fresh new plan with its
-- own instructions").
--
-- When Operations asks to pay out less than the plan's verified savings, the request also carries the instructions for
-- a new plan: plan type (which sets the rate), amount, how often, tenure in months and interest pay day. The Branch
-- Manager approves both together. When Accounts' payout posts:
--   1. the rest of the savings (verified savings then, less the payout) leaves the old plan as a "Moved to new plan"
--      entry, and the old plan closes as liquidated, as before;
--   2. a new plan opens that day with those instructions, and the same amount arrives on it as a verified "Moved from
--      liquidated plan" entry, so it earns interest from that day.
-- No cash moves for the rest, and it stays in Member savings (2110), so there is no journal. Paying out the full
-- savings works as before, with no new plan.
-- Re-runnable: safe to paste into the SQL Editor more than once.

-- ---------------------------------------------------------------------------
-- Moving savings between plans
-- ---------------------------------------------------------------------------

alter type public.contribution_kind add value if not exists 'plan_transfer';

-- New enum values can't be used as literals in the transaction that adds them, so these compare as text.
alter table public.contributions drop constraint if exists contributions_sign;
alter table public.contributions add constraint contributions_sign check (
  (kind::text in ('reversal', 'loan_penalty') and amount < 0)
  or (kind::text = 'plan_transfer' and amount <> 0)
  or (kind::text not in ('reversal', 'loan_penalty', 'plan_transfer') and amount > 0)
);
alter table public.contributions drop constraint if exists contributions_payment_method_check;
alter table public.contributions add constraint contributions_payment_method_check
  check (payment_method in ('bank_transfer', 'cash', 'pos', 'cheque', 'savings_deduction', 'plan_transfer'));
alter table public.contributions drop constraint if exists contributions_transfer_method;
alter table public.contributions add constraint contributions_transfer_method
  check ((kind::text = 'plan_transfer') = (payment_method = 'plan_transfer'));

-- Unchanged, except that a move between plans is written only by the liquidation workflow, arrives already verified,
-- and can leave a plan that has matured.
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
  if new.kind::text in ('loan_penalty', 'plan_transfer') then
    new.verified_at := now();
  else
    new.verified_at := null;
  end if;

  if new.kind = 'reversal' then
    select * into v_original from public.contributions where id = new.reverses_id;
    if v_original.member_plan_id is distinct from new.member_plan_id then
      raise exception 'a reversal must be on the same plan as the entry it reverses' using errcode = 'check_violation';
    end if;
    if v_original.kind = 'reversal' or v_original.kind::text in ('loan_penalty', 'plan_transfer') then
      raise exception 'a reversal can''t itself be reversed, and late fee deductions and moves between plans aren''t reversed here'
        using errcode = 'check_violation';
    end if;
    if new.amount <> -v_original.amount then
      raise exception 'a reversal must be for exactly the original amount' using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

-- Moves stay in Member savings, so Accounts doesn't post them as receipts or payments.
create or replace view public.contributions_awaiting_posting with (security_invoker = true) as
select c.id, c.member_id, c.member_plan_id, c.branch_id, c.kind, c.amount, c.paid_on, c.payment_method, c.reference,
       c.verified_at, concat_ws(' ', m.first_name, m.middle_name, m.last_name) as member_name, m.membership_no
from public.contributions c
join public.members m on m.id = c.member_id
where c.verified_at is not null
  and c.kind::text not in ('loan_penalty', 'plan_transfer')
  and not exists (
    select 1 from public.finance_transactions t where t.contribution_id = c.id and t.status <> 'rejected'
  );
grant select on public.contributions_awaiting_posting to authenticated;

-- ---------------------------------------------------------------------------
-- The new plan's instructions on the liquidation request
-- ---------------------------------------------------------------------------

alter table public.plan_liquidations
  add column if not exists new_plan_type text references public.plan_types (code),
  add column if not exists new_contribution_amount numeric(14, 2),
  add column if not exists new_contribution_frequency text,
  add column if not exists new_tenure_months integer,
  add column if not exists new_interest_pay_day smallint,
  -- Filled in when the payout posts.
  add column if not exists rollover_amount numeric(16, 2),
  add column if not exists new_member_plan_id uuid references public.member_plans (id);

alter table public.plan_liquidations drop constraint if exists plan_liquidations_new_plan;
alter table public.plan_liquidations add constraint plan_liquidations_new_plan check (
  (new_plan_type is null and new_contribution_amount is null and new_contribution_frequency is null
     and new_tenure_months is null and new_interest_pay_day is null)
  or (new_plan_type is not null and new_contribution_amount > 0
      and new_contribution_frequency in ('weekly', 'monthly', 'quarterly', 'one_off')
      and new_tenure_months between 1 and 120
      and (new_interest_pay_day is null or new_interest_pay_day between 1 and 31))
);

-- The plan a liquidation's remaining savings moved into.
alter table public.member_plans add column if not exists from_liquidation_id uuid references public.plan_liquidations (id);

-- Only a liquidation sets it.
create or replace function app.member_plans_from_liquidation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not app.in_workflow() then
    new.from_liquidation_id := null;
  end if;
  return new;
end;
$$;
drop trigger if exists member_plans_from_liquidation on public.member_plans;
create trigger member_plans_from_liquidation
  before insert on public.member_plans
  for each row execute function app.member_plans_from_liquidation();

-- Checks a new plan's instructions against its plan type, the same rules as adding a plan.
create or replace function app.check_new_plan_instructions(
  p_plan_type text, p_amount numeric, p_frequency text, p_months integer, p_pay_day integer
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_type public.plan_types;
begin
  select * into v_type from public.plan_types where code = p_plan_type and is_active;
  if not found then
    raise exception 'choose the plan for the rest of the savings' using errcode = 'check_violation';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'enter the new plan''s amount' using errcode = 'check_violation';
  end if;
  if p_frequency is null or p_frequency not in ('weekly', 'monthly', 'quarterly', 'one_off') then
    raise exception 'choose how often the member pays into the new plan' using errcode = 'check_violation';
  end if;
  if p_months is null or p_months not between 1 and 120 then
    raise exception 'enter the new plan''s tenure in months (1 to 120)' using errcode = 'check_violation';
  end if;
  if v_type.tenure_months is not null and not (p_months = any (v_type.tenure_months)) then
    raise exception '% runs for % months', v_type.name, array_to_string(v_type.tenure_months, ', ', '')
      using errcode = 'check_violation';
  end if;
  if v_type.min_amount is not null and p_amount < v_type.min_amount then
    raise exception '% needs at least % naira', v_type.name, to_char(v_type.min_amount, 'FM999,999,999,990.00')
      using errcode = 'check_violation';
  end if;
  if v_type.max_amount is not null and p_amount > v_type.max_amount then
    raise exception '% takes at most % naira', v_type.name, to_char(v_type.max_amount, 'FM999,999,999,990.00')
      using errcode = 'check_violation';
  end if;
  if not v_type.dividends_at_maturity and (p_pay_day is null or p_pay_day not between 1 and 31) then
    raise exception 'choose the day of the month the new plan''s interest is paid' using errcode = 'check_violation';
  end if;
end;
$$;
revoke all on function app.check_new_plan_instructions(text, numeric, text, integer, integer) from public, anon;

-- Operations raises a liquidation request, or corrects and resends one that was sent back. Paying out less than the
-- plan's verified savings needs the new plan's instructions in p_new_plan:
--   {"plan_type": "gold", "contribution_amount": 50000, "contribution_frequency": "one_off", "tenure_months": 6,
--    "interest_pay_day": 25}
drop function if exists public.request_liquidation(uuid, uuid, numeric, text, text, text, text, text);
create or replace function public.request_liquidation(
  p_id uuid, p_plan_id uuid, p_amount numeric, p_account_name text, p_bank_code text, p_bank_name text,
  p_account_no text, p_note text, p_new_plan jsonb default null
)
returns public.plan_liquidations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan public.member_plans;
  v_row public.plan_liquidations;
  v_savings numeric;
  v_type text;
  v_amount numeric;
  v_frequency text;
  v_months integer;
  v_pay_day integer;
begin
  if p_id is not null then
    select * into v_row from public.plan_liquidations where id = p_id for update;
    if not found or not app.has_branch_permission('liquidations.request', v_row.branch_id) then
      raise exception 'liquidation request not found' using errcode = 'no_data_found';
    end if;
    if v_row.status <> 'returned' then
      raise exception 'only a request that was sent back can be changed and sent again' using errcode = 'check_violation';
    end if;
    p_plan_id := v_row.member_plan_id;
  end if;

  select * into v_plan from public.member_plans where id = p_plan_id;
  if not found or not app.has_branch_permission('liquidations.request', v_plan.branch_id) then
    raise exception 'plan not found' using errcode = 'no_data_found';
  end if;
  if v_plan.status not in ('active', 'matured') then
    raise exception 'this plan is % and can''t be liquidated', v_plan.status using errcode = 'check_violation';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'enter the amount to pay the member' using errcode = 'check_violation';
  end if;
  if p_account_name is null or length(trim(p_account_name)) < 2 then
    raise exception 'enter the name on the member''s bank account' using errcode = 'check_violation';
  end if;
  if nullif(trim(coalesce(p_bank_code, '')), '') is null and nullif(trim(coalesce(p_bank_name, '')), '') is null then
    raise exception 'choose the member''s bank' using errcode = 'check_violation';
  end if;
  if p_account_no is null or trim(p_account_no) !~ '^[0-9]{10}$' then
    raise exception 'the account number must be 10 digits' using errcode = 'check_violation';
  end if;

  if p_id is null and exists (
    select 1 from public.plan_liquidations q
    where q.member_plan_id = v_plan.id and q.status in ('pending_approval', 'returned', 'approved')
  ) then
    raise exception 'this plan already has a liquidation request in progress' using errcode = 'check_violation';
  end if;

  -- Part of the savings: the whole plan is liquidated and the rest goes into a new plan.
  v_savings := app.plan_savings(v_plan.id);
  if p_amount < v_savings then
    if p_new_plan is null or jsonb_typeof(p_new_plan) <> 'object' then
      raise exception 'only part of the savings is being paid, so give the instructions for the new plan the rest goes into'
        using errcode = 'check_violation';
    end if;
    v_type := nullif(trim(p_new_plan ->> 'plan_type'), '');
    v_amount := nullif(trim(p_new_plan ->> 'contribution_amount'), '')::numeric;
    v_frequency := nullif(trim(p_new_plan ->> 'contribution_frequency'), '');
    v_months := nullif(trim(p_new_plan ->> 'tenure_months'), '')::integer;
    v_pay_day := nullif(trim(p_new_plan ->> 'interest_pay_day'), '')::integer;
    perform app.check_new_plan_instructions(v_type, v_amount, v_frequency, v_months, v_pay_day);
    if (select dividends_at_maturity from public.plan_types where code = v_type) then
      v_pay_day := null;
    end if;
  end if;

  perform app.begin_workflow();
  if p_id is null then
    insert into public.plan_liquidations (
      liquidation_no, member_plan_id, member_id, branch_id, amount, plan_savings, beneficiary_account_name, bank_code,
      bank_name, bank_account_no, note, status, requested_by, requested_at, new_plan_type, new_contribution_amount,
      new_contribution_frequency, new_tenure_months, new_interest_pay_day
    ) values (
      'LIQ-' || lpad(nextval('public.liquidation_no_seq')::text, 6, '0'), v_plan.id, v_plan.member_id, v_plan.branch_id,
      p_amount, v_savings, trim(p_account_name), nullif(trim(coalesce(p_bank_code, '')), ''),
      coalesce(nullif(trim(coalesce(p_bank_name, '')), ''), '-'), trim(p_account_no), nullif(trim(coalesce(p_note, '')), ''),
      'pending_approval', auth.uid(), now(), v_type, v_amount, v_frequency, v_months, v_pay_day
    ) returning * into v_row;
  else
    update public.plan_liquidations
       set amount = p_amount, plan_savings = v_savings, beneficiary_account_name = trim(p_account_name),
           bank_code = nullif(trim(coalesce(p_bank_code, '')), ''),
           bank_name = coalesce(nullif(trim(coalesce(p_bank_name, '')), ''), '-'), bank_account_no = trim(p_account_no),
           note = nullif(trim(coalesce(p_note, '')), ''), status = 'pending_approval', requested_by = auth.uid(),
           requested_at = now(), decided_by = null, decided_at = null, new_plan_type = v_type,
           new_contribution_amount = v_amount, new_contribution_frequency = v_frequency, new_tenure_months = v_months,
           new_interest_pay_day = v_pay_day
     where id = p_id
     returning * into v_row;
  end if;
  perform app.end_workflow();
  return v_row;
exception
  when unique_violation then
    raise exception 'this plan already has a liquidation request in progress' using errcode = 'check_violation';
  when invalid_text_representation then
    raise exception 'the new plan''s amount, tenure and pay day must be numbers' using errcode = 'check_violation';
end;
$$;

-- ---------------------------------------------------------------------------
-- Paying it: the rest moves into the new plan when the payout posts
-- ---------------------------------------------------------------------------

-- Accounts raises the payout for an approved liquidation and sends it for approval. Unchanged, except that if the
-- plan's savings are now more than the payout and the request has no new plan, it goes back to Operations first:
-- money left behind on a closed plan would be lost to the member.
create or replace function public.raise_liquidation_payment(p_id uuid, p_bank_account_id uuid, p_txn_date date default current_date)
returns public.finance_transactions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.plan_liquidations;
  v_plan_name text;
  v_attempt int;
  v_savings numeric;
  v_txn public.finance_transactions;
begin
  select * into v_row from public.plan_liquidations where id = p_id for update;
  if not found or not app.has_branch_permission('accounts.payments.request', v_row.branch_id) then
    raise exception 'liquidation request not found' using errcode = 'no_data_found';
  end if;
  if not exists (select 1 from public.bank_accounts b where b.id = p_bank_account_id and b.branch_id = v_row.branch_id and b.is_active) then
    raise exception 'choose an active bank or cash account of the member''s branch' using errcode = 'check_violation';
  end if;
  v_savings := app.plan_savings(v_row.member_plan_id);
  if v_savings > v_row.amount and v_row.new_plan_type is null then
    raise exception 'the plan''s savings are now ₦%, more than this payout, and the request has no new plan for the rest: send it back to Operations to add one',
      to_char(v_savings, 'FM999,999,999,990.00') using errcode = 'check_violation';
  end if;
  if v_savings > v_row.amount then
    perform app.check_new_plan_instructions(v_row.new_plan_type, v_row.new_contribution_amount,
      v_row.new_contribution_frequency, v_row.new_tenure_months, v_row.new_interest_pay_day);
  end if;
  select pt.name into v_plan_name
  from public.member_plans p join public.plan_types pt on pt.code = p.plan_type where p.id = v_row.member_plan_id;
  select count(*) + 1 into v_attempt from public.finance_transactions where liquidation_id = p_id;

  insert into public.finance_transactions (
    direction, transaction_type, txn_date, amount, bank_account_id, member_id, liquidation_id, counterparty, reference,
    description, branch_id
  ) values (
    'payment', 'savings_withdrawal', coalesce(p_txn_date, current_date), v_row.amount, p_bank_account_id, v_row.member_id,
    p_id, v_row.beneficiary_account_name,
    v_row.liquidation_no || case when v_attempt > 1 then '/' || v_attempt else '' end,
    format('Liquidation %s of %s plan: pay %s, %s %s', v_row.liquidation_no, v_plan_name, v_row.beneficiary_account_name,
           v_row.bank_name, v_row.bank_account_no),
    v_row.branch_id
  ) returning * into v_txn;

  return public.submit_finance_transaction(v_txn.id);
end;
$$;

-- Keeps the liquidation in step with its payment. When the payout posts, the rest of the savings moves into the new
-- plan and the old plan closes. Reversing the payout moves it back and cancels the new plan, as long as nothing else
-- has happened on the new plan.
create or replace function app.finance_transactions_liquidation_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_was_on boolean := app.in_workflow();
  v_row public.plan_liquidations;
  v_old public.member_plans;
  v_type public.plan_types;
  v_rest numeric;
  v_new_id uuid;
begin
  if new.liquidation_id is null or (tg_op = 'UPDATE' and new.status is not distinct from old.status) then
    return null;
  end if;
  select * into v_row from public.plan_liquidations where id = new.liquidation_id for update;
  perform app.begin_workflow();
  update public.plan_liquidations
     set payment_txn_id = new.id, payment_txn_no = new.txn_no, payment_status = new.status::text
   where id = v_row.id;

  if new.status = 'posted' then
    select * into v_old from public.member_plans where id = v_row.member_plan_id for update;
    v_rest := app.plan_savings(v_old.id) - v_row.amount;
    if v_rest > 0 and v_row.new_plan_type is not null then
      select * into v_type from public.plan_types where code = v_row.new_plan_type;
      insert into public.member_plans (
        member_id, branch_id, plan_type, contribution_amount, contribution_frequency, start_date, maturity_date,
        interest_pay_day, from_liquidation_id
      ) values (
        v_old.member_id, v_old.branch_id, v_row.new_plan_type, v_row.new_contribution_amount,
        v_row.new_contribution_frequency, current_date,
        (current_date + make_interval(months => v_row.new_tenure_months))::date,
        case when v_type.dividends_at_maturity then null else v_row.new_interest_pay_day end, v_row.id
      ) returning id into v_new_id;

      insert into public.contributions (member_plan_id, member_id, branch_id, kind, amount, paid_on, payment_method, reference, notes)
      values (v_old.id, v_old.member_id, v_old.branch_id, 'plan_transfer', -v_rest, current_date, 'plan_transfer',
              v_row.liquidation_no, 'Rest of the savings moved to a new ' || v_type.name || ' plan on liquidation');
      insert into public.contributions (member_plan_id, member_id, branch_id, kind, amount, paid_on, payment_method, reference, notes)
      values (v_new_id, v_old.member_id, v_old.branch_id, 'plan_transfer', v_rest, current_date, 'plan_transfer',
              v_row.liquidation_no, 'Moved from the liquidated plan');

      update public.plan_liquidations set rollover_amount = v_rest, new_member_plan_id = v_new_id where id = v_row.id;
    end if;
    update public.plan_liquidations set status = 'paid', paid_at = now() where id = v_row.id;
    update public.member_plans set status = 'liquidated', closed_at = now() where id = v_row.member_plan_id;

  elsif new.status = 'reversed' and v_row.status = 'paid' then
    update public.member_plans set status = 'active', closed_at = null where id = v_row.member_plan_id;
    if v_row.new_member_plan_id is not null then
      if exists (
        select 1 from public.contributions c
        where c.member_plan_id = v_row.new_member_plan_id
          and not (c.kind::text = 'plan_transfer' and c.reference = v_row.liquidation_no)
      ) or exists (select 1 from public.plan_liquidations q where q.member_plan_id = v_row.new_member_plan_id) then
        raise exception 'the new plan opened by liquidation % already has other entries or a liquidation, so this payout can''t be reversed',
          v_row.liquidation_no using errcode = 'check_violation';
      end if;
      insert into public.contributions (member_plan_id, member_id, branch_id, kind, amount, paid_on, payment_method, reference, notes)
      values (v_row.new_member_plan_id, v_row.member_id, v_row.branch_id, 'plan_transfer', -v_row.rollover_amount,
              current_date, 'plan_transfer', v_row.liquidation_no, 'Moved back: the liquidation payout was reversed');
      insert into public.contributions (member_plan_id, member_id, branch_id, kind, amount, paid_on, payment_method, reference, notes)
      values (v_row.member_plan_id, v_row.member_id, v_row.branch_id, 'plan_transfer', v_row.rollover_amount,
              current_date, 'plan_transfer', v_row.liquidation_no, 'Moved back: the liquidation payout was reversed');
      update public.member_plans set status = 'cancelled', closed_at = now() where id = v_row.new_member_plan_id;
    end if;
    update public.plan_liquidations
       set status = 'approved', paid_at = null, rollover_amount = null, new_member_plan_id = null
     where id = v_row.id;
  end if;
  if not v_was_on then
    perform app.end_workflow();
  end if;
  return null;
end;
$$;

-- The queue for each page, now with the new plan's instructions and, once paid, the plan the rest moved into.
drop function if exists public.liquidation_requests(text[]);
create or replace function public.liquidation_requests(p_status text[] default null)
returns table (
  id uuid, liquidation_no text, branch_id uuid, branch_name text, status text, amount numeric, plan_savings numeric,
  member_id uuid, member_name text, membership_no text, member_plan_id uuid, plan_name text, start_date date,
  maturity_date date, beneficiary_account_name text, bank_code text, bank_name text, bank_account_no text, note text,
  requested_by uuid, requested_by_name text, requested_at timestamptz, decided_by uuid, decided_by_name text,
  decided_at timestamptz, decision_note text, payment_txn_id uuid, payment_txn_no text, payment_status text, paid_at timestamptz,
  current_savings numeric, new_plan_type text, new_plan_name text, new_contribution_amount numeric,
  new_contribution_frequency text, new_tenure_months integer, new_interest_pay_day smallint, new_plan_rate numeric,
  rollover_amount numeric, new_member_plan_id uuid
)
language sql
stable
security definer
set search_path = ''
as $$
  select l.id, l.liquidation_no, l.branch_id, b.name, l.status, l.amount, l.plan_savings,
         m.id, concat_ws(' ', m.first_name, m.middle_name, m.last_name), m.membership_no, p.id, pt.name, p.start_date,
         p.maturity_date, l.beneficiary_account_name, l.bank_code, l.bank_name, l.bank_account_no, l.note,
         l.requested_by, rs.full_name, l.requested_at, l.decided_by, ds.full_name, l.decided_at, l.decision_note,
         l.payment_txn_id, l.payment_txn_no, l.payment_status, l.paid_at,
         app.plan_savings(p.id), l.new_plan_type, npt.name, l.new_contribution_amount, l.new_contribution_frequency,
         l.new_tenure_months, l.new_interest_pay_day, npt.interest_rate, l.rollover_amount, l.new_member_plan_id
  from public.plan_liquidations l
  join public.branches b on b.id = l.branch_id
  join public.members m on m.id = l.member_id
  join public.member_plans p on p.id = l.member_plan_id
  join public.plan_types pt on pt.code = p.plan_type
  join public.staff rs on rs.id = l.requested_by
  left join public.staff ds on ds.id = l.decided_by
  left join public.plan_types npt on npt.code = l.new_plan_type
  where (p_status is null or l.status = any (p_status))
    and (app.has_branch_permission('members.read', l.branch_id) or app.has_branch_permission('accounts.read', l.branch_id))
  order by l.requested_at desc;
$$;

revoke all on function public.request_liquidation(uuid, uuid, numeric, text, text, text, text, text, jsonb) from public, anon;
revoke all on function public.raise_liquidation_payment(uuid, uuid, date) from public, anon;
revoke all on function public.liquidation_requests(text[]) from public, anon;
grant execute on function public.request_liquidation(uuid, uuid, numeric, text, text, text, text, text, jsonb) to authenticated;
grant execute on function public.raise_liquidation_payment(uuid, uuid, date) to authenticated;
grant execute on function public.liquidation_requests(text[]) to authenticated;

-- ---------------------------------------------------------------------------
-- A new plan's opening money counts towards what it expects
-- ---------------------------------------------------------------------------

-- Unchanged, except that savings moved into a plan count as paid, so a new plan isn't shown as owing its first amount.
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
    sum(x.amount) filter (
      where coalesce(r.kind, x.kind) = 'scheduled' or (x.kind::text = 'plan_transfer' and x.amount > 0)
    ) as scheduled,
    sum(x.amount) filter (where coalesce(r.kind, x.kind) = 'top_up') as top_ups,
    sum(x.amount) filter (where x.verified_at is not null) as verified,
    max(x.paid_on) filter (where x.kind <> 'reversal') as last_paid_on
  from public.contributions x
  left join public.contributions r on r.id = x.reverses_id
  where x.member_plan_id = p.id
) c on true;

grant select on public.plan_progress to authenticated;
