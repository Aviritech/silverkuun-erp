-- Kuun's answers on savings (sosa, 2026-11-19, in the walkthrough's open questions):
--   * Dividends: "a full month is 21 days and above and part months earn nothing".
--   * Child savings: "interests should be paid at maturity, that's every 3 month".
--   * Top-up letter: printed only "after naimat confirms" the money (Accounts posts the receipt).
-- Re-runnable: safe to paste into the SQL Editor more than once.

-- ---------------------------------------------------------------------------
-- 1. A month held 21 days or more counts as a full month
-- ---------------------------------------------------------------------------

-- Whole months a contribution paid on p_from has been held by p_to, counting the month still running once it has
-- been held 21 days or more.
create or replace function app.months_held(p_from date, p_to date)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case when p_to <= p_from then 0 else
    (extract(year from age(p_to, p_from)) * 12 + extract(month from age(p_to, p_from))
     + case when extract(day from age(p_to, p_from)) >= 21 then 1 else 0 end)::integer
  end;
$$;
grant execute on function app.months_held(date, date) to authenticated;

-- Dividends a plan has built up by a date, counted to its maturity at the latest: each verified contribution earns the
-- plan's monthly rate (the annual rate divided by 12) for every month it has been held, by the 21-day rule above.
create or replace function public.plan_accrued_dividends(p_plan_id uuid, p_date date default current_date)
returns numeric
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(sum(round(
           c.amount * p.interest_rate / 100 / 12 * app.months_held(c.paid_on, least(p_date, p.maturity_date)),
           2)), 0)::numeric(16, 2)
  from public.member_plans p
  join public.contributions c on c.member_plan_id = p.id
  where p.id = p_plan_id and c.verified_at is not null and c.paid_on <= least(p_date, p.maturity_date);
$$;
revoke all on function public.plan_accrued_dividends(uuid, date) from public, anon;
grant execute on function public.plan_accrued_dividends(uuid, date) to authenticated;

-- The monthly interest due on a date. Unchanged, except that a deposit earns the month's interest only once it has
-- been held 21 days by the pay day; anything taken off the plan (reversals, deductions) and savings moved in from an
-- earlier plan (a roll-over or partial liquidation, already held) count at once.
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
  with plans as (
    select p.member_id, p.interest_rate, coalesce(sum(c.amount), 0) as savings
    from public.member_plans p
    left join public.contributions c
      on c.member_plan_id = p.id and c.verified_at is not null and c.paid_on <= p_date
     and (c.amount < 0 or c.kind::text = 'plan_transfer' or c.paid_on <= p_date - 21)
    where p.status = 'active' and p.start_date <= p_date and not p.dividends_at_maturity
      and p.interest_pay_day is not null
      and (p.interest_pay_day = extract(day from p_date)
           or (p_date = (date_trunc('month', p_date) + interval '1 month - 1 day')::date
               and p.interest_pay_day > extract(day from p_date)))
    group by p.id
  )
  select m.id, m.membership_no, concat_ws(' ', m.first_name, m.middle_name, m.last_name), m.branch_id, b.name,
         m.bank_name, m.bank_code, m.bank_account_no,
         sum(p.savings)::numeric(16, 2),
         round(sum(p.savings * p.interest_rate) / sum(p.savings), 2),
         sum(round(p.savings * p.interest_rate / 100 / 12, 2))::numeric(16, 2)
  from plans p
  join public.members m on m.id = p.member_id
  join public.branches b on b.id = m.branch_id
  where m.status = 'approved'
    and (p_branch_id is null or m.branch_id = p_branch_id)
    and (p_region_id is null or b.region_id = p_region_id)
  group by m.id, m.membership_no, m.first_name, m.middle_name, m.last_name, m.branch_id, b.name,
           m.bank_name, m.bank_code, m.bank_account_no
  having sum(p.savings) > 0
  order by b.name, m.last_name, m.first_name;
$$;

-- ---------------------------------------------------------------------------
-- 2. Child savings pay at maturity
-- ---------------------------------------------------------------------------

update public.plan_types
   set dividends_at_maturity = true,
       description = 'A 3 month plan with a minimum of 200,000 naira. Interest is paid with the savings at maturity.'
 where code = 'child';
-- Child plans already running switch too: they leave the monthly interest schedule and are paid at maturity.
update public.member_plans set dividends_at_maturity = true, interest_pay_day = null
 where plan_type = 'child' and not dividends_at_maturity;

-- ---------------------------------------------------------------------------
-- 3. Which of a member's entries Accounts has confirmed
-- ---------------------------------------------------------------------------

-- The member's contributions whose receipt Accounts has confirmed and posted (for a top up, the Receipts Confirmation
-- Accountant's confirmation). Branch staff can't read Accounts' transactions, so this answers only yes or no per entry.
create or replace function public.member_confirmed_contributions(p_member_id uuid)
returns table (contribution_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id
  from public.contributions c
  join public.finance_transactions t on t.contribution_id = c.id and t.status = 'posted'
  where c.member_id = p_member_id
    and app.has_branch_permission('members.read', c.branch_id);
$$;
revoke all on function public.member_confirmed_contributions(uuid) from public, anon;
grant execute on function public.member_confirmed_contributions(uuid) to authenticated;
