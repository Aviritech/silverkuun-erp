-- Letters from the library, and Kuun's plan rates.
--
-- 1. Kuun's rate structure, from "KUUN Business Rates and Document Samples" in the project library. The sheet and the
--    agreement letters quote monthly rates (Silver 4%, Gold 5%, Platinum 6%, Children Savings 5%, Kuun Exploit 3.5%).
--    interest_rate stays an annual figure, so the monthly interest (savings x rate / 12) and the dividend functions are
--    unchanged: 4% a month is stored as 48. Plans already open keep the rate they were opened at.
-- 2. A new plan, Kuun Exploit, for deposits of 5,000,000 to 50,000,000 naira, and a maximum amount per plan type.
-- 3. branch_manager_name(): the name the letters are signed off with.

-- ---------------------------------------------------------------------------
-- 1 and 2. Rates and amount ranges
-- ---------------------------------------------------------------------------

alter table public.plan_types
  -- The largest amount a plan of this type can be opened for. Null means no maximum.
  add column max_amount numeric(14, 2) check (max_amount is null or max_amount > 0),
  add constraint plan_types_amounts check (max_amount is null or min_amount is null or max_amount >= min_amount);

-- The Silver, Gold and Platinum amount ranges are written into the description as a guide, not enforced: those plans
-- also take weekly and monthly contributions, which are smaller than the deposit range.
update public.plan_types set interest_rate = 48, description = '4% a month. Deposits of 200,000 to 400,000 naira.' where code = 'silver';
update public.plan_types set interest_rate = 60, description = '5% a month. Deposits of 500,000 to 5,000,000 naira.' where code = 'gold';
update public.plan_types set interest_rate = 72, description = '6% a month. Deposits of 1,000,000 naira and above.' where code = 'platinum';
update public.plan_types set interest_rate = 60, description = '5% a month. A 3 month plan with a minimum of 200,000 naira.' where code = 'child';

insert into public.plan_types (code, name, description, sort_order, interest_rate, min_amount, max_amount)
values ('exploit', 'Kuun Exploit', '3.5% a month. Deposits of 5,000,000 to 50,000,000 naira.', 6, 42, 5000000, 50000000)
on conflict (code) do nothing;

-- New plans must keep to their type's tenures and amount range.
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
  if v_type.max_amount is not null and new.contribution_amount > v_type.max_amount then
    raise exception '% takes at most % naira', v_type.name, to_char(v_type.max_amount, 'FM999,999,999,990.00')
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Who signs the branch's letters
-- ---------------------------------------------------------------------------

-- The branch's Branch Manager, for the sign-off on agreement letters, statements and loan offer letters. The longest
-- serving one when a branch has more than one. Any active staff member can read it, as with staff_display_names().
create or replace function public.branch_manager_name(p_branch_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select s.full_name
  from public.staff_roles r
  join public.staff s on s.id = r.staff_id
  where r.role_code = 'branch_manager' and r.branch_id = p_branch_id and s.is_active
    and exists (select 1 from public.staff me where me.id = auth.uid() and me.is_active)
  order by r.granted_at, s.full_name
  limit 1;
$$;
revoke all on function public.branch_manager_name(uuid) from public, anon;
grant execute on function public.branch_manager_name(uuid) to authenticated;
