-- Interest pay day moves from the member to each savings plan, and member addresses get state, LGA, town and landmark.
--
--   1. The day of the month a plan's interest is paid is chosen when the plan is opened, not on the member file. A
--      member with two plans can be paid on different days. Plans that pay their dividends at maturity (Target savings)
--      have no pay day. Existing plans take the day that was on their member, and the member column is dropped.
--      Holders of members.amend can change an active plan's pay day later, giving a reason.
--   2. Members get a town or city, LGA, state and nearest landmark beside the street address. They are optional in the
--      database so existing members stay valid; the Add new member form asks for state and LGA.

-- ---------------------------------------------------------------------------
-- 1. Interest pay day on the plan
-- ---------------------------------------------------------------------------

alter table public.member_plans
  -- Day of the month interest is paid. In shorter months, days past the end are paid on the last day.
  add column interest_pay_day smallint check (interest_pay_day between 1 and 31),
  -- Why the pay day was last changed after the plan was opened. Kept with the row, so the audit trail shows it.
  add column pay_day_change_reason text;

-- Plans that already exist take their member's pay day. The plan guard blocks direct updates, so step around it for
-- this one-off backfill.
alter table public.member_plans disable trigger member_plans_guard;
update public.member_plans p
set interest_pay_day = m.interest_pay_day
from public.members m
where m.id = p.member_id and m.interest_pay_day is not null and not p.dividends_at_maturity;
alter table public.member_plans enable trigger member_plans_guard;

alter table public.members drop column interest_pay_day;

-- Plans that pay at maturity never carry a monthly pay day. Set on insert, after the plan type decides how it pays.
create or replace function app.member_plans_rate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    select interest_rate, dividends_at_maturity into new.interest_rate, new.dividends_at_maturity
    from public.plan_types where code = new.plan_type;
    if new.dividends_at_maturity then
      new.interest_pay_day := null;
    end if;
    new.pay_day_change_reason := null;
  end if;
  return new;
end;
$$;

-- Changes the day an active plan's monthly interest is paid. Needs members.amend and a reason, like any other change
-- to an approved member's payment details.
create or replace function public.change_plan_interest_pay_day(p_plan_id uuid, p_day integer, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan public.member_plans;
begin
  select * into v_plan from public.member_plans where id = p_plan_id for update;
  if not found or not app.has_branch_permission('members.amend', v_plan.branch_id) then
    raise exception 'you can''t change this plan''s interest pay day' using errcode = 'insufficient_privilege';
  end if;
  if v_plan.status <> 'active' then
    raise exception 'only an active plan''s interest pay day can change' using errcode = 'check_violation';
  end if;
  if v_plan.dividends_at_maturity then
    raise exception 'this plan pays its dividends at maturity, so it has no monthly pay day' using errcode = 'check_violation';
  end if;
  if p_day is null or p_day not between 1 and 31 then
    raise exception 'choose a pay day from 1 to 31' using errcode = 'check_violation';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 5 then
    raise exception 'say why the pay day is changing' using errcode = 'check_violation';
  end if;

  perform app.begin_workflow();
  update public.member_plans set interest_pay_day = p_day, pay_day_change_reason = trim(p_reason) where id = p_plan_id;
  perform app.end_workflow();
end;
$$;
revoke all on function public.change_plan_interest_pay_day(uuid, integer, text) from public, anon;
grant execute on function public.change_plan_interest_pay_day(uuid, integer, text) to authenticated;

-- The payments due on a date: active plans whose pay day it is, added up per member, with the member's bank details,
-- savings at that date and the month's interest. Placeholder formula until Kuun confirms it: for each plan, verified
-- contributions to date times the plan's annual rate, divided by 12. Plans that pay at maturity have no pay day, so
-- they never appear.
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
    left join public.contributions c on c.member_plan_id = p.id and c.verified_at is not null and c.paid_on <= p_date
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
-- 2. Member address details
-- ---------------------------------------------------------------------------

alter table public.members
  add column address_city text check (address_city is null or length(trim(address_city)) between 1 and 100),
  add column address_lga text check (address_lga is null or length(trim(address_lga)) between 1 and 100),
  add column address_state text check (address_state is null or length(trim(address_state)) between 1 and 100),
  add column address_landmark text check (address_landmark is null or length(trim(address_landmark)) between 1 and 200);
