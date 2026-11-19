-- A special (negotiated) rate on one member's plan (sosa, 2026-11-19: "Allow a special rate on a single plan, with a
-- reason, approved by CEO, initiated by an officer then to branch manager then to head of operations then regional
-- manager then BDM then CEO. The letters and interest then use that rate.").
--
-- An Operations officer asks for the rate on an active plan, with a reason. The request then needs, in order: the
-- Branch Manager, the Head of Operations, the Regional Manager, the BDM and finally the CEO. Each step is a different
-- person from the one who asked and from everyone who approved before. Anyone at their step may decline it with a
-- reason, which ends it; the officer may cancel it while it is open. When the CEO approves, the plan's rate changes
-- from that day: the agreement letter, dividend statement, maturity letter and monthly interest all use it.
-- New roles: Regional Manager (scoped to a region), BDM and CEO. Re-runnable.

-- ---------------------------------------------------------------------------
-- Roles and permissions
-- ---------------------------------------------------------------------------

insert into public.departments (code, name) values ('management', 'Management') on conflict (code) do nothing;

insert into public.permissions (code, description) values
  ('plans.rate.request', 'Ask for a special rate on a member''s plan'),
  ('plans.rate.approve_branch', 'Approve a special plan rate as Branch Manager'),
  ('plans.rate.approve_operations', 'Approve a special plan rate as Head of Operations'),
  ('plans.rate.approve_region', 'Approve a special plan rate as Regional Manager'),
  ('plans.rate.approve_bdm', 'Approve a special plan rate as BDM'),
  ('plans.rate.approve_ceo', 'Give the final approval of a special plan rate as CEO')
on conflict (code) do update set description = excluded.description;

insert into public.roles (code, department_code, name, description) values
  ('regional_manager', 'branch_operations', 'Regional Manager', 'Oversees the branches in a region; approves special plan rates for them'),
  ('bdm', 'management', 'BDM', 'Business Development Manager; approves special plan rates'),
  ('ceo', 'management', 'CEO', 'Gives the final approval of special plan rates')
on conflict (code) do update set name = excluded.name, description = excluded.description;

insert into public.role_permissions (role_code, permission_code) values
  ('admin_officer', 'plans.rate.request'),
  ('branch_manager', 'plans.rate.approve_branch'),
  ('head_of_administration', 'plans.rate.approve_operations'),
  ('regional_manager', 'plans.rate.approve_region'),
  ('bdm', 'plans.rate.approve_bdm'),
  ('ceo', 'plans.rate.approve_ceo'),
  -- The approvers read the member's file, as the credit roles do.
  ('regional_manager', 'module.administration'),
  ('regional_manager', 'members.read'),
  ('bdm', 'module.administration'),
  ('bdm', 'members.read'),
  ('ceo', 'module.administration'),
  ('ceo', 'members.read')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Requests
-- ---------------------------------------------------------------------------

alter table public.member_plans add column if not exists special_rate_request_id uuid;

create sequence if not exists public.plan_rate_request_no_seq;

create table if not exists public.plan_rate_requests (
  id uuid primary key default gen_random_uuid(),
  request_no text not null unique,
  member_plan_id uuid not null references public.member_plans (id) on delete restrict,
  member_id uuid not null references public.members (id),
  branch_id uuid not null references public.branches (id),
  -- Annual rates, as the plan stores them (the letters quote them a month: divide by 12).
  current_rate numeric(5, 2) not null,
  requested_rate numeric(5, 2) not null check (requested_rate > 0 and requested_rate <= 100),
  reason text not null check (length(trim(reason)) >= 5),
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined', 'cancelled')),
  stage text check (stage in ('branch_manager', 'head_of_operations', 'regional_manager', 'bdm', 'ceo')),
  requested_by uuid not null references public.staff (id),
  requested_at timestamptz not null default now(),
  closed_by uuid references public.staff (id),
  closed_at timestamptz,
  close_note text,
  constraint plan_rate_requests_stage check ((status = 'pending') = (stage is not null))
);
create index if not exists plan_rate_requests_plan_idx on public.plan_rate_requests (member_plan_id);
create unique index if not exists plan_rate_requests_one_open_idx on public.plan_rate_requests (member_plan_id) where status = 'pending';

create table if not exists public.plan_rate_approvals (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.plan_rate_requests (id) on delete restrict,
  stage text not null,
  approved_by uuid not null references public.staff (id),
  approved_at timestamptz not null default now(),
  note text,
  unique (request_id, stage)
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'member_plans_special_rate_request_fk') then
    alter table public.member_plans add constraint member_plans_special_rate_request_fk
      foreign key (special_rate_request_id) references public.plan_rate_requests (id);
  end if;
end;
$$;

create or replace function app.plan_rate_requests_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not app.in_workflow() then
    raise exception 'special rates change only through the special rate requests' using errcode = 'insufficient_privilege';
  end if;
  if tg_op = 'DELETE' then
    raise exception 'special rate requests are never deleted' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

drop trigger if exists plan_rate_requests_guard on public.plan_rate_requests;
create trigger plan_rate_requests_guard before insert or update or delete on public.plan_rate_requests
  for each row execute function app.plan_rate_requests_guard();
drop trigger if exists plan_rate_approvals_guard on public.plan_rate_approvals;
create trigger plan_rate_approvals_guard before insert or update or delete on public.plan_rate_approvals
  for each row execute function app.plan_rate_requests_guard();

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'audit_log_changes' and tgrelid = 'public.plan_rate_requests'::regclass) then
    perform app.enable_audit('public.plan_rate_requests');
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'audit_log_changes' and tgrelid = 'public.plan_rate_approvals'::regclass) then
    perform app.enable_audit('public.plan_rate_approvals');
  end if;
end;
$$;

alter table public.plan_rate_requests enable row level security;
alter table public.plan_rate_approvals enable row level security;
drop policy if exists "member readers see special rate requests" on public.plan_rate_requests;
create policy "member readers see special rate requests" on public.plan_rate_requests for select to authenticated
  using (app.has_branch_permission('members.read', branch_id));
drop policy if exists "member readers see special rate approvals" on public.plan_rate_approvals;
create policy "member readers see special rate approvals" on public.plan_rate_approvals for select to authenticated
  using (exists (select 1 from public.plan_rate_requests r where r.id = request_id and app.has_branch_permission('members.read', r.branch_id)));

-- The permission each step needs, and the step after it.
create or replace function app.plan_rate_stage_permission(p_stage text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_stage
    when 'branch_manager' then 'plans.rate.approve_branch'
    when 'head_of_operations' then 'plans.rate.approve_operations'
    when 'regional_manager' then 'plans.rate.approve_region'
    when 'bdm' then 'plans.rate.approve_bdm'
    when 'ceo' then 'plans.rate.approve_ceo'
  end;
$$;

create or replace function app.plan_rate_next_stage(p_stage text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_stage
    when 'branch_manager' then 'head_of_operations'
    when 'head_of_operations' then 'regional_manager'
    when 'regional_manager' then 'bdm'
    when 'bdm' then 'ceo'
  end;
$$;

-- p_monthly_rate is the monthly percentage the letters quote, e.g. 6.5.
create or replace function public.request_plan_rate(p_plan_id uuid, p_monthly_rate numeric, p_reason text)
returns public.plan_rate_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_was_on boolean := app.in_workflow();
  v_plan public.member_plans;
  v_row public.plan_rate_requests;
begin
  select * into v_plan from public.member_plans where id = p_plan_id for update;
  if not found or not app.has_branch_permission('members.read', v_plan.branch_id) then
    raise exception 'plan not found' using errcode = 'no_data_found';
  end if;
  if not app.has_branch_permission('plans.rate.request', v_plan.branch_id) then
    raise exception 'only an Operations officer can ask for a special rate' using errcode = 'insufficient_privilege';
  end if;
  if v_plan.status <> 'active' then
    raise exception 'a special rate can only be set on an active plan' using errcode = 'check_violation';
  end if;
  -- Plans keep the annual rate to 2 decimals, at most 100% a year (8.33% a month).
  if p_monthly_rate is null or p_monthly_rate <= 0 or round(p_monthly_rate * 12, 2) > 100 then
    raise exception 'give the monthly rate, more than 0 and at most 8.33%%' using errcode = 'check_violation';
  end if;
  if round(p_monthly_rate * 12, 2) = v_plan.interest_rate then
    raise exception 'that is already the plan''s rate' using errcode = 'check_violation';
  end if;
  if p_reason is null or length(trim(p_reason)) < 5 then
    raise exception 'say why the member should have this rate' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.plan_rate_requests r where r.member_plan_id = p_plan_id and r.status = 'pending') then
    raise exception 'a special rate for this plan is already waiting for approval' using errcode = 'check_violation';
  end if;

  perform app.begin_workflow();
  insert into public.plan_rate_requests
    (request_no, member_plan_id, member_id, branch_id, current_rate, requested_rate, reason, status, stage, requested_by)
  values
    ('RATE-' || lpad(nextval('public.plan_rate_request_no_seq')::text, 6, '0'), p_plan_id, v_plan.member_id, v_plan.branch_id,
     v_plan.interest_rate, round(p_monthly_rate * 12, 2), trim(p_reason), 'pending', 'branch_manager', auth.uid())
  returning * into v_row;
  if not v_was_on then
    perform app.end_workflow();
  end if;
  return v_row;
end;
$$;
revoke all on function public.request_plan_rate(uuid, numeric, text) from public, anon;
grant execute on function public.request_plan_rate(uuid, numeric, text) to authenticated;

create or replace function public.decide_plan_rate(p_id uuid, p_approve boolean, p_note text)
returns public.plan_rate_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_was_on boolean := app.in_workflow();
  v_row public.plan_rate_requests;
begin
  select * into v_row from public.plan_rate_requests where id = p_id for update;
  if not found or not app.has_branch_permission('members.read', v_row.branch_id) then
    raise exception 'request not found' using errcode = 'no_data_found';
  end if;
  if v_row.status <> 'pending' then
    raise exception 'this request is already %', v_row.status using errcode = 'check_violation';
  end if;
  if not app.has_branch_permission(app.plan_rate_stage_permission(v_row.stage), v_row.branch_id) then
    raise exception 'this request is waiting for the %', replace(v_row.stage, '_', ' ') using errcode = 'insufficient_privilege';
  end if;
  if auth.uid() = v_row.requested_by
     or exists (select 1 from public.plan_rate_approvals a where a.request_id = p_id and a.approved_by = auth.uid()) then
    raise exception 'someone who asked for or already approved this rate can''t approve it again' using errcode = 'insufficient_privilege';
  end if;
  if not p_approve and length(trim(coalesce(p_note, ''))) < 5 then
    raise exception 'give the reason for declining' using errcode = 'check_violation';
  end if;

  perform app.begin_workflow();
  if not p_approve then
    update public.plan_rate_requests
       set status = 'declined', stage = null, closed_by = auth.uid(), closed_at = now(), close_note = trim(p_note)
     where id = p_id returning * into v_row;
  else
    insert into public.plan_rate_approvals (request_id, stage, approved_by, note)
    values (p_id, v_row.stage, auth.uid(), nullif(trim(coalesce(p_note, '')), ''));
    if v_row.stage = 'ceo' then
      update public.plan_rate_requests
         set status = 'approved', stage = null, closed_by = auth.uid(), closed_at = now(), close_note = nullif(trim(coalesce(p_note, '')), '')
       where id = p_id returning * into v_row;
      update public.member_plans
         set interest_rate = v_row.requested_rate, special_rate_request_id = v_row.id
       where id = v_row.member_plan_id;
    else
      update public.plan_rate_requests set stage = app.plan_rate_next_stage(v_row.stage) where id = p_id returning * into v_row;
    end if;
  end if;
  if not v_was_on then
    perform app.end_workflow();
  end if;
  return v_row;
end;
$$;
revoke all on function public.decide_plan_rate(uuid, boolean, text) from public, anon;
grant execute on function public.decide_plan_rate(uuid, boolean, text) to authenticated;

create or replace function public.cancel_plan_rate(p_id uuid, p_note text)
returns public.plan_rate_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_was_on boolean := app.in_workflow();
  v_row public.plan_rate_requests;
begin
  select * into v_row from public.plan_rate_requests where id = p_id for update;
  if not found or not app.has_branch_permission('plans.rate.request', v_row.branch_id) then
    raise exception 'request not found' using errcode = 'no_data_found';
  end if;
  if v_row.status <> 'pending' then
    raise exception 'this request is already %', v_row.status using errcode = 'check_violation';
  end if;
  if length(trim(coalesce(p_note, ''))) < 5 then
    raise exception 'say why the request is cancelled' using errcode = 'check_violation';
  end if;
  perform app.begin_workflow();
  update public.plan_rate_requests
     set status = 'cancelled', stage = null, closed_by = auth.uid(), closed_at = now(), close_note = trim(p_note)
   where id = p_id returning * into v_row;
  if not v_was_on then
    perform app.end_workflow();
  end if;
  return v_row;
end;
$$;
revoke all on function public.cancel_plan_rate(uuid, text) from public, anon;
grant execute on function public.cancel_plan_rate(uuid, text) to authenticated;

-- The requests a staff member may see, with names, for the Special rates page.
create or replace function public.plan_rate_request_list()
returns table (
  id uuid, request_no text, branch_id uuid, branch_name text, member_id uuid, member_name text, membership_no text,
  member_plan_id uuid, plan_name text, current_rate numeric, requested_rate numeric, reason text, status text, stage text,
  requested_by uuid, requested_by_name text, requested_at timestamptz, closed_by_name text, closed_at timestamptz,
  close_note text, approvals jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.request_no, r.branch_id, b.name, r.member_id, concat_ws(' ', m.first_name, m.middle_name, m.last_name),
         m.membership_no, r.member_plan_id, t.name, r.current_rate, r.requested_rate, r.reason, r.status, r.stage,
         r.requested_by, rs.full_name, r.requested_at, cs.full_name, r.closed_at, r.close_note,
         coalesce((select jsonb_agg(jsonb_build_object('stage', a.stage, 'by', s.full_name, 'by_id', a.approved_by, 'at', a.approved_at, 'note', a.note)
                                    order by a.approved_at)
                   from public.plan_rate_approvals a join public.staff s on s.id = a.approved_by
                   where a.request_id = r.id), '[]'::jsonb)
  from public.plan_rate_requests r
  join public.branches b on b.id = r.branch_id
  join public.members m on m.id = r.member_id
  join public.member_plans p on p.id = r.member_plan_id
  join public.plan_types t on t.code = p.plan_type
  join public.staff rs on rs.id = r.requested_by
  left join public.staff cs on cs.id = r.closed_by
  where app.has_branch_permission('members.read', r.branch_id)
  order by r.requested_at desc;
$$;
revoke all on function public.plan_rate_request_list() from public, anon;
grant execute on function public.plan_rate_request_list() to authenticated;
