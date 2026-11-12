-- Target savings and Child savings plans.
--
-- Target savings: the member picks a tenure of 3, 6 or 12 months. Nothing is paid out along the way: the principal and
-- every dividend that built up are paid together at the end of the tenure, so these plans stay off the monthly interest
-- payment schedule.
-- Child savings: a 3 month plan with a minimum amount of 200,000 naira.
--
-- The rates below are placeholders until Kuun confirms them, like the Silver, Gold and Platinum rates.

alter table public.plan_types
  -- The tenures, in months, a plan of this type can run for. Null means any maturity date the officer sets.
  add column tenure_months integer[] check (tenure_months is null or (cardinality(tenure_months) > 0 and 0 < all (tenure_months))),
  -- The smallest amount a plan of this type can be opened for. Null means no minimum.
  add column min_amount numeric(14, 2) check (min_amount is null or min_amount > 0),
  -- True when dividends build up and are paid with the principal at maturity, not monthly.
  add column dividends_at_maturity boolean not null default false;

insert into public.plan_types (code, name, description, sort_order, interest_rate, tenure_months, min_amount, dividends_at_maturity)
values
  ('target', 'Target savings', 'Principal and all dividends paid at the end of a 3, 6 or 12 month tenure.', 4, 12, '{3,6,12}', null, true),
  ('child', 'Child savings', 'A 3 month plan with a minimum of 200,000 naira.', 5, 10, '{3}', 200000, false)
on conflict (code) do nothing;

-- New plans must keep to their type's tenures and minimum amount.
create or replace function app.member_plans_type_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type public.plan_types;
begin
  select * into v_type from public.plan_types where code = new.plan_type;
  if v_type.tenure_months is not null and not exists (
    select 1 from unnest(v_type.tenure_months) as t(months)
    where (new.start_date + make_interval(months => t.months))::date = new.maturity_date
  ) then
    raise exception '% runs for % months: the maturity date must be that long after the start date',
      v_type.name, array_to_string(v_type.tenure_months, ', ', '') using errcode = 'check_violation';
  end if;
  if v_type.min_amount is not null and new.contribution_amount < v_type.min_amount then
    raise exception '% needs at least % naira', v_type.name, to_char(v_type.min_amount, 'FM999,999,999,990.00')
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger member_plans_type_rules
  before insert on public.member_plans
  for each row execute function app.member_plans_type_rules();

-- Each plan keeps whether it pays at maturity, so a later change to the plan type doesn't change how existing plans pay.
alter table public.member_plans add column dividends_at_maturity boolean not null default false;

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
  end if;
  return new;
end;
$$;

-- Dividends a plan has built up by a date, counted to its maturity at the latest. Placeholder formula, the same as the
-- monthly one until Kuun confirms it: each verified contribution earns the plan's annual rate divided by 12 for every
-- full month it has been held.
create or replace function public.plan_accrued_dividends(p_plan_id uuid, p_date date default current_date)
returns numeric
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(sum(round(
           c.amount * p.interest_rate / 100 / 12
           * (extract(year from age(least(p_date, p.maturity_date), c.paid_on)) * 12
              + extract(month from age(least(p_date, p.maturity_date), c.paid_on))),
           2)), 0)::numeric(16, 2)
  from public.member_plans p
  join public.contributions c on c.member_plan_id = p.id
  where p.id = p_plan_id and c.verified_at is not null and c.paid_on <= least(p_date, p.maturity_date);
$$;
revoke all on function public.plan_accrued_dividends(uuid, date) from public, anon;
grant execute on function public.plan_accrued_dividends(uuid, date) to authenticated;

-- The monthly interest payment schedule, now leaving out plans that pay their dividends at maturity.
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
    where p.status = 'active' and p.start_date <= p_date and not p.dividends_at_maturity
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
