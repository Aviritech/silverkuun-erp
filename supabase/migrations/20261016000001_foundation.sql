-- Foundation: organisation structure, staff, roles & permissions, and the audit trail.
--
-- Access model
--   * Every table has row level security enabled. Nothing is readable or writable unless a policy allows it.
--   * Staff receive roles. A role grants permissions. A role assignment is scoped to one branch, one region,
--     or (when both are null) the whole organisation.
--   * Department modules add their own permissions and roles in their own migrations.
--   * Every change to an audited table is written to public.audit_log, which is append-only.

create schema if not exists app;
grant usage on schema app to authenticated;

-- ---------------------------------------------------------------------------
-- Organisation structure
-- ---------------------------------------------------------------------------

create table public.regions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  created_at timestamptz not null default now()
);

create table public.branches (
  id uuid primary key default gen_random_uuid(),
  region_id uuid not null references public.regions (id) on delete restrict,
  code text not null unique,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index branches_region_id_idx on public.branches (region_id);

create table public.departments (
  code text primary key check (code ~ '^[a-z][a-z0-9_]*$'),
  name text not null,
  is_active boolean not null default true
);

-- ---------------------------------------------------------------------------
-- Roles & permissions
-- ---------------------------------------------------------------------------

create table public.permissions (
  code text primary key check (code ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  description text not null
);

create table public.roles (
  code text primary key check (code ~ '^[a-z][a-z0-9_]*$'),
  department_code text not null references public.departments (code) on delete restrict,
  name text not null,
  description text not null default ''
);

create table public.role_permissions (
  role_code text not null references public.roles (code) on delete cascade,
  permission_code text not null references public.permissions (code) on delete cascade,
  primary key (role_code, permission_code)
);

-- ---------------------------------------------------------------------------
-- Staff
-- ---------------------------------------------------------------------------

create table public.staff (
  id uuid primary key references auth.users (id) on delete restrict,
  full_name text not null,
  email text not null unique,
  department_code text not null references public.departments (code) on delete restrict,
  home_branch_id uuid references public.branches (id) on delete restrict,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.staff_roles (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff (id) on delete cascade,
  role_code text not null references public.roles (code) on delete restrict,
  branch_id uuid references public.branches (id) on delete restrict,
  region_id uuid references public.regions (id) on delete restrict,
  granted_by uuid references public.staff (id),
  granted_at timestamptz not null default now(),
  constraint staff_roles_single_scope check (branch_id is null or region_id is null)
);
create unique index staff_roles_unique_scope_idx
  on public.staff_roles (staff_id, role_code, coalesce(branch_id, region_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index staff_roles_staff_id_idx on public.staff_roles (staff_id);

-- ---------------------------------------------------------------------------
-- Permission checks (used by RLS policies and the app)
-- ---------------------------------------------------------------------------

-- Every permission the signed-in staff member holds, with the scope it applies to.
create or replace function public.my_permissions()
returns table (permission_code text, branch_id uuid, region_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct rp.permission_code, sr.branch_id, sr.region_id
  from public.staff s
  join public.staff_roles sr on sr.staff_id = s.id
  join public.role_permissions rp on rp.role_code = sr.role_code
  where s.id = auth.uid()
    and s.is_active;
$$;

-- True when the signed-in staff member holds the permission in any scope.
create or replace function app.has_permission(p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.my_permissions() mp where mp.permission_code = p_permission);
$$;

-- True when the signed-in staff member holds the permission for the given branch:
-- organisation-wide, through the branch's region, or for the branch itself.
create or replace function app.has_branch_permission(p_permission text, p_branch_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.my_permissions() mp
    where mp.permission_code = p_permission
      and (
        (mp.branch_id is null and mp.region_id is null)
        or mp.branch_id = p_branch_id
        or mp.region_id = (select b.region_id from public.branches b where b.id = p_branch_id)
      )
  );
$$;

revoke all on function public.my_permissions() from public, anon;
revoke all on function app.has_permission(text) from public, anon;
revoke all on function app.has_branch_permission(text, uuid) from public, anon;
grant execute on function public.my_permissions() to authenticated;
grant execute on function app.has_permission(text) to authenticated;
grant execute on function app.has_branch_permission(text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Audit trail
-- ---------------------------------------------------------------------------

create table public.audit_log (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_id uuid,
  table_name text not null,
  record_id text,
  branch_id uuid,
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  changed_fields text[],
  old_data jsonb,
  new_data jsonb
);
create index audit_log_table_record_idx on public.audit_log (table_name, record_id);
create index audit_log_actor_idx on public.audit_log (actor_id, occurred_at desc);
create index audit_log_branch_idx on public.audit_log (branch_id, occurred_at desc);
create index audit_log_occurred_at_idx on public.audit_log (occurred_at desc);

create or replace function app.log_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_changed text[];
begin
  if tg_op = 'UPDATE' then
    select array_agg(key order by key) into v_changed
    from jsonb_each(v_new) n
    where n.value is distinct from v_old -> n.key;

    if v_changed is null then
      return new; -- nothing actually changed
    end if;
  end if;

  insert into public.audit_log (actor_id, table_name, record_id, branch_id, action, changed_fields, old_data, new_data)
  values (
    auth.uid(),
    tg_table_schema || '.' || tg_table_name,
    v_row ->> 'id',
    nullif(v_row ->> 'branch_id', '')::uuid,
    tg_op,
    v_changed,
    v_old,
    v_new
  );

  return coalesce(new, old);
end;
$$;

-- Attach the audit trigger to a table. Department migrations call this for every table they create.
create or replace function app.enable_audit(p_table regclass)
returns void
language plpgsql
as $$
begin
  execute format(
    'create trigger audit_log_changes after insert or update or delete on %s for each row execute function app.log_change()',
    p_table
  );
end;
$$;
revoke all on function app.enable_audit(regclass) from public, anon, authenticated;

create or replace function app.reject_audit_log_change()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_log is append-only';
end;
$$;

create trigger audit_log_append_only
  before update or delete on public.audit_log
  for each row execute function app.reject_audit_log_change();

create trigger audit_log_no_truncate
  before truncate on public.audit_log
  for each statement execute function app.reject_audit_log_change();

select app.enable_audit('public.regions');
select app.enable_audit('public.branches');
select app.enable_audit('public.departments');
select app.enable_audit('public.permissions');
select app.enable_audit('public.roles');
select app.enable_audit('public.role_permissions');
select app.enable_audit('public.staff');
select app.enable_audit('public.staff_roles');

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.regions enable row level security;
alter table public.branches enable row level security;
alter table public.departments enable row level security;
alter table public.permissions enable row level security;
alter table public.roles enable row level security;
alter table public.role_permissions enable row level security;
alter table public.staff enable row level security;
alter table public.staff_roles enable row level security;
alter table public.audit_log enable row level security;

-- Reference data: readable by any signed-in staff member, managed by system administrators.
create policy "staff can read regions" on public.regions for select to authenticated using (true);
create policy "system admins manage regions" on public.regions for all to authenticated
  using (app.has_permission('system.manage')) with check (app.has_permission('system.manage'));

create policy "staff can read branches" on public.branches for select to authenticated using (true);
create policy "system admins manage branches" on public.branches for all to authenticated
  using (app.has_permission('system.manage')) with check (app.has_permission('system.manage'));

create policy "staff can read departments" on public.departments for select to authenticated using (true);
create policy "system admins manage departments" on public.departments for all to authenticated
  using (app.has_permission('system.manage')) with check (app.has_permission('system.manage'));

create policy "staff can read permissions" on public.permissions for select to authenticated using (true);
create policy "staff can read roles" on public.roles for select to authenticated using (true);
create policy "staff can read role permissions" on public.role_permissions for select to authenticated using (true);
-- Permissions, roles and their mapping are changed through migrations only, so they stay reviewable in git.

-- Staff directory.
create policy "staff can read own profile" on public.staff for select to authenticated
  using (id = auth.uid());
create policy "staff readers can read all staff" on public.staff for select to authenticated
  using (app.has_permission('staff.read'));
create policy "staff managers manage staff" on public.staff for all to authenticated
  using (app.has_permission('staff.manage')) with check (app.has_permission('staff.manage'));

-- Role assignments. Nobody can grant or change their own roles.
create policy "staff can read own roles" on public.staff_roles for select to authenticated
  using (staff_id = auth.uid());
create policy "staff readers can read all roles" on public.staff_roles for select to authenticated
  using (app.has_permission('staff.read'));
create policy "staff managers grant roles to others" on public.staff_roles for insert to authenticated
  with check (app.has_permission('staff.manage') and staff_id <> auth.uid() and granted_by = auth.uid());
create policy "staff managers revoke roles from others" on public.staff_roles for delete to authenticated
  using (app.has_permission('staff.manage') and staff_id <> auth.uid());

-- Audit trail: written only by the trigger, read by holders of audit.trail.read within their scope.
create policy "auditors read the audit trail" on public.audit_log for select to authenticated
  using (
    case
      when branch_id is null then app.has_permission('audit.trail.read')
      else app.has_branch_permission('audit.trail.read', branch_id)
    end
  );

revoke insert, update, delete, truncate on public.audit_log from anon, authenticated;
revoke all on all tables in schema public from anon;

-- ---------------------------------------------------------------------------
-- Seed data: departments, platform permissions and roles
-- ---------------------------------------------------------------------------

insert into public.departments (code, name) values
  ('system', 'System Administration'),
  ('administration', 'Administration'),
  ('branch_operations', 'Branch Operations'),
  ('internal_audit', 'Internal Audit');

insert into public.permissions (code, description) values
  ('system.manage', 'Manage regions, branches and departments'),
  ('staff.read', 'View the staff directory and role assignments'),
  ('staff.manage', 'Create staff accounts and assign roles'),
  ('audit.trail.read', 'View the audit trail of changes'),
  ('module.administration', 'Open the Administration module'),
  ('module.internal_audit', 'Open the Internal Audit module');

insert into public.roles (code, department_code, name, description) values
  ('system_admin', 'system', 'System Administrator', 'Manages the organisation structure and staff accounts'),
  ('admin_officer', 'administration', 'Administrative Officer', 'Onboards members and maintains their records'),
  ('head_of_administration', 'administration', 'Head of Administration', 'Reviews agreement letters before issuance'),
  ('branch_manager', 'branch_operations', 'Branch Manager', 'Reviews, approves and signs member files for a branch'),
  ('internal_auditor', 'internal_audit', 'Internal Auditor', 'Read-only oversight across branches and regions');

insert into public.role_permissions (role_code, permission_code) values
  ('system_admin', 'system.manage'),
  ('system_admin', 'staff.read'),
  ('system_admin', 'staff.manage'),
  ('admin_officer', 'module.administration'),
  ('head_of_administration', 'module.administration'),
  ('head_of_administration', 'staff.read'),
  ('branch_manager', 'module.administration'),
  ('internal_auditor', 'module.internal_audit'),
  ('internal_auditor', 'audit.trail.read'),
  ('internal_auditor', 'staff.read');
