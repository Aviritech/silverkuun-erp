-- Usage log: how staff use the ERP.
--
-- * public.activity_log records sign-ins (and failed attempts), sign-outs, pages opened, report downloads and
--   password changes. Like audit_log it can't be edited: nobody can update a row, and signed-in staff can't insert,
--   change or delete rows directly. Rows are written only through public.log_activity(), which stamps the signed-in
--   staff member's own id, so nobody can log activity in someone else's name.
-- * Changes to records are already in audit_log. The usage functions below read both tables, but return only the
--   record type, action and the names of the fields changed from audit_log, never the before and after values.
-- * activity.read (System Administrators and Internal Auditors) opens the Usage page. A reader limited to a branch or
--   region sees only people whose home branch is in it; people with no home branch (head office) are visible only to
--   readers who hold activity.read for the whole organisation.

insert into public.permissions (code, description) values
  ('activity.read', 'See how staff use the ERP: sign-ins, pages opened, downloads and changes made');

insert into public.role_permissions (role_code, permission_code) values
  ('system_admin', 'activity.read'),
  ('internal_auditor', 'activity.read');

create table public.activity_log (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  -- The staff member, or null for a failed sign-in with an email that matches no one.
  staff_id uuid references public.staff (id) on delete set null,
  -- The staff member's home branch at the time, which decides who may read the row.
  branch_id uuid references public.branches (id) on delete set null,
  event text not null check (event in ('sign_in', 'sign_in_failed', 'sign_out', 'page_view', 'download', 'password_changed')),
  path text check (length(path) <= 300),
  -- The department module the page belongs to (administration, accounts, ...), and a readable name for the page.
  module text check (length(module) <= 40),
  label text check (length(label) <= 200),
  detail jsonb not null default '{}'::jsonb,
  user_agent text check (length(user_agent) <= 400),
  ip text check (length(ip) <= 64)
);
create index activity_log_occurred_at_idx on public.activity_log (occurred_at desc);
create index activity_log_staff_idx on public.activity_log (staff_id, occurred_at desc);
create index activity_log_branch_idx on public.activity_log (branch_id, occurred_at desc);
create index activity_log_event_idx on public.activity_log (event, occurred_at desc);

create or replace function app.reject_activity_log_update()
returns trigger
language plpgsql
as $$
begin
  raise exception 'activity_log entries can''t be changed';
end;
$$;

create trigger activity_log_no_update
  before update on public.activity_log
  for each row execute function app.reject_activity_log_update();

alter table public.activity_log enable row level security;

-- True when the signed-in staff member may see the activity of someone whose home branch is p_branch_id.
create or replace function app.can_read_activity(p_branch_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_branch_id is null then exists (
      select 1 from public.my_permissions() mp
      where mp.permission_code = 'activity.read' and mp.branch_id is null and mp.region_id is null
    )
    else app.has_branch_permission('activity.read', p_branch_id)
  end;
$$;
revoke all on function app.can_read_activity(uuid) from public, anon;
grant execute on function app.can_read_activity(uuid) to authenticated;

create policy "activity readers read the usage log" on public.activity_log for select to authenticated
  using (app.can_read_activity(branch_id));

revoke insert, update, delete, truncate on public.activity_log from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Writing the log
-- ---------------------------------------------------------------------------

-- Records something the signed-in staff member did. Called by the app; failures there never stop the user.
create or replace function public.log_activity(
  p_event text,
  p_path text default null,
  p_module text default null,
  p_label text default null,
  p_detail jsonb default '{}'::jsonb,
  p_user_agent text default null,
  p_ip text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_branch uuid;
begin
  if p_event not in ('sign_in', 'sign_out', 'page_view', 'download', 'password_changed') then
    raise exception 'Unknown activity: %', p_event;
  end if;
  select s.home_branch_id into v_branch from public.staff s where s.id = auth.uid() and s.is_active;
  if not found then
    return; -- not a signed-in, active staff member: nothing to record
  end if;
  insert into public.activity_log (staff_id, branch_id, event, path, module, label, detail, user_agent, ip)
  values (
    auth.uid(), v_branch, p_event, left(p_path, 300), left(p_module, 40), left(p_label, 200),
    coalesce(p_detail, '{}'::jsonb), left(p_user_agent, 400), left(p_ip, 64)
  );
end;
$$;
revoke all on function public.log_activity(text, text, text, text, jsonb, text, text) from public, anon;
grant execute on function public.log_activity(text, text, text, text, jsonb, text, text) to authenticated;

-- A failed sign-in. Nobody is signed in yet, so only the server (service role) may call it.
create or replace function public.log_failed_sign_in(p_email text, p_user_agent text default null, p_ip text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid;
  v_branch uuid;
begin
  select s.id, s.home_branch_id into v_staff, v_branch from public.staff s where lower(s.email) = lower(trim(p_email));
  insert into public.activity_log (staff_id, branch_id, event, path, label, detail, user_agent, ip)
  values (
    v_staff, v_branch, 'sign_in_failed', '/login', 'Sign in',
    jsonb_build_object('email', left(lower(trim(p_email)), 200)), left(p_user_agent, 400), left(p_ip, 64)
  );
end;
$$;
revoke all on function public.log_failed_sign_in(text, text, text) from public, anon, authenticated;
grant execute on function public.log_failed_sign_in(text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- Reading the log: activity and record changes together
-- ---------------------------------------------------------------------------

-- Every usage event in the period (Lagos calendar days, inclusive) that the reader may see, newest first.
-- p_kind: 'all', a single event ('sign_in', 'page_view', ...) or 'change' for record changes from audit_log.
create or replace function app.usage_rows(
  p_from date,
  p_to date,
  p_staff uuid default null,
  p_branch uuid default null,
  p_department text default null,
  p_role text default null,
  p_kind text default 'all'
)
returns table (
  occurred_at timestamptz,
  kind text,
  staff_id uuid,
  branch_id uuid,
  path text,
  module text,
  label text,
  detail jsonb,
  user_agent text,
  ip text
)
language sql
stable
security definer
set search_path = ''
as $$
  with bounds as (
    select (p_from::timestamp at time zone 'Africa/Lagos') as starts,
           ((p_to + 1)::timestamp at time zone 'Africa/Lagos') as ends
  ),
  -- The reader's scope, worked out once rather than for every row.
  grants as (
    select mp.branch_id, mp.region_id from public.my_permissions() mp where mp.permission_code = 'activity.read'
  ),
  readable as (
    select b.id from public.branches b
    where exists (
      select 1 from grants g
      where (g.branch_id is null and g.region_id is null) or g.branch_id = b.id or g.region_id = b.region_id
    )
  ),
  events as (
    select a.occurred_at, a.event as kind, a.staff_id, a.branch_id, a.path, a.module, a.label, a.detail, a.user_agent, a.ip
    from public.activity_log a, bounds b
    where a.occurred_at >= b.starts and a.occurred_at < b.ends
      and (coalesce(p_kind, 'all') = 'all' or a.event = p_kind)
    union all
    select l.occurred_at, 'change', l.actor_id, s.home_branch_id, null, null,
           (case l.action when 'INSERT' then 'Created' when 'UPDATE' then 'Changed' else 'Deleted' end)
             || ' ' || replace(l.table_name, 'public.', ''),
           jsonb_build_object(
             'table', replace(l.table_name, 'public.', ''),
             'action', l.action,
             'record_id', l.record_id,
             'fields', to_jsonb(coalesce(l.changed_fields, '{}'::text[]))
           ),
           null, null
    from public.audit_log l
    join public.staff s on s.id = l.actor_id, bounds b
    where l.occurred_at >= b.starts and l.occurred_at < b.ends
      and coalesce(p_kind, 'all') in ('all', 'change')
  )
  select e.*
  from events e
  left join public.staff s on s.id = e.staff_id
  where (
      e.branch_id in (select id from readable)
      or (e.branch_id is null and exists (select 1 from grants g where g.branch_id is null and g.region_id is null))
    )
    and (p_staff is null or e.staff_id = p_staff)
    and (p_branch is null or e.branch_id = p_branch)
    and (p_department is null or s.department_code = p_department)
    and (p_role is null or exists (select 1 from public.staff_roles r where r.staff_id = e.staff_id and r.role_code = p_role))
  order by e.occurred_at desc;
$$;
revoke all on function app.usage_rows(date, date, uuid, uuid, text, text, text) from public, anon, authenticated;

-- The timeline, with the person's name.
create or replace function public.usage_events(
  p_from date,
  p_to date,
  p_staff uuid default null,
  p_branch uuid default null,
  p_department text default null,
  p_role text default null,
  p_kind text default 'all',
  p_limit integer default 200,
  p_offset integer default 0
)
returns table (
  occurred_at timestamptz,
  kind text,
  staff_id uuid,
  staff_name text,
  branch_id uuid,
  path text,
  module text,
  label text,
  detail jsonb,
  user_agent text,
  ip text
)
language sql
stable
security definer
set search_path = ''
as $$
  select u.occurred_at, u.kind, u.staff_id, coalesce(s.full_name, u.detail ->> 'email'), u.branch_id, u.path, u.module, u.label, u.detail,
    u.user_agent, u.ip
  from app.usage_rows(p_from, p_to, p_staff, p_branch, p_department, p_role, p_kind) u
  left join public.staff s on s.id = u.staff_id
  order by u.occurred_at desc
  limit least(greatest(coalesce(p_limit, 200), 1), 5000)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

-- One row per person: active staff matching the filters (even with no activity), plus anyone else who had some.
create or replace function public.usage_by_person(
  p_from date,
  p_to date,
  p_branch uuid default null,
  p_department text default null,
  p_role text default null
)
returns table (
  staff_id uuid,
  full_name text,
  department_code text,
  branch_id uuid,
  sign_ins bigint,
  failed_sign_ins bigint,
  page_views bigint,
  changes bigint,
  downloads bigint,
  active_days bigint,
  last_seen timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with u as (
    select * from app.usage_rows(p_from, p_to, null, p_branch, p_department, p_role, 'all') where staff_id is not null
  ),
  people as (
    select s.id from public.staff s
    where s.is_active
      and app.has_permission('activity.read')
      and app.can_read_activity(s.home_branch_id)
      and (p_branch is null or s.home_branch_id = p_branch)
      and (p_department is null or s.department_code = p_department)
      and (p_role is null or exists (select 1 from public.staff_roles r where r.staff_id = s.id and r.role_code = p_role))
    union
    select distinct u.staff_id from u
  )
  select s.id, s.full_name, s.department_code, s.home_branch_id,
    count(*) filter (where u.kind = 'sign_in'),
    count(*) filter (where u.kind = 'sign_in_failed'),
    count(*) filter (where u.kind = 'page_view'),
    count(*) filter (where u.kind = 'change'),
    count(*) filter (where u.kind = 'download'),
    count(distinct (u.occurred_at at time zone 'Africa/Lagos')::date) filter (where u.kind not in ('sign_in_failed')),
    max(u.occurred_at) filter (where u.kind <> 'sign_in_failed')
  from people p
  join public.staff s on s.id = p.id
  left join u on u.staff_id = s.id
  group by s.id, s.full_name, s.department_code, s.home_branch_id
  order by max(u.occurred_at) desc nulls last, s.full_name;
$$;

-- The pages people open most.
create or replace function public.usage_by_page(
  p_from date,
  p_to date,
  p_staff uuid default null,
  p_branch uuid default null,
  p_department text default null,
  p_role text default null
)
returns table (module text, label text, views bigint, people bigint, last_opened timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select u.module, u.label, count(*), count(distinct u.staff_id), max(u.occurred_at)
  from app.usage_rows(p_from, p_to, p_staff, p_branch, p_department, p_role, 'page_view') u
  group by u.module, u.label
  order by count(*) desc, u.label
  limit 50;
$$;

-- Each day in the period: how many people were active and what they did.
create or replace function public.usage_by_day(
  p_from date,
  p_to date,
  p_staff uuid default null,
  p_branch uuid default null,
  p_department text default null,
  p_role text default null
)
returns table (day date, people bigint, sign_ins bigint, page_views bigint, changes bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select (u.occurred_at at time zone 'Africa/Lagos')::date,
    count(distinct u.staff_id) filter (where u.kind <> 'sign_in_failed'),
    count(*) filter (where u.kind = 'sign_in'),
    count(*) filter (where u.kind = 'page_view'),
    count(*) filter (where u.kind = 'change')
  from app.usage_rows(p_from, p_to, p_staff, p_branch, p_department, p_role, 'all') u
  group by 1
  order by 1;
$$;

revoke all on function public.usage_events(date, date, uuid, uuid, text, text, text, integer, integer) from public, anon;
revoke all on function public.usage_by_person(date, date, uuid, text, text) from public, anon;
revoke all on function public.usage_by_page(date, date, uuid, uuid, text, text) from public, anon;
revoke all on function public.usage_by_day(date, date, uuid, uuid, text, text) from public, anon;
grant execute on function public.usage_events(date, date, uuid, uuid, text, text, text, integer, integer) to authenticated;
grant execute on function public.usage_by_person(date, date, uuid, text, text) to authenticated;
grant execute on function public.usage_by_page(date, date, uuid, uuid, text, text) to authenticated;
grant execute on function public.usage_by_day(date, date, uuid, uuid, text, text) to authenticated;
