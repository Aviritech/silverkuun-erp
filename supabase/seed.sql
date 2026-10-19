-- Local development data only. Loaded by `npx supabase db reset`; never run this against staging or production.
-- Every test account uses the password: Password123!

insert into public.regions (id, code, name) values
  ('10000000-0000-0000-0000-000000000001', 'SW', 'South West'),
  ('10000000-0000-0000-0000-000000000002', 'NC', 'North Central');

insert into public.branches (id, region_id, code, name) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'LAG', 'Lagos'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'ABJ', 'Abuja');

-- email, full name, department, role, branch (null = whole organisation)
create temporary table seed_staff (id uuid, email text, full_name text, department text, role text, branch uuid);
insert into seed_staff values
  ('30000000-0000-0000-0000-000000000001', 'sysadmin@kuun.test', 'Sam Sysadmin', 'system', 'system_admin', null),
  ('30000000-0000-0000-0000-000000000002', 'officer.lagos@kuun.test', 'Ola Officer', 'administration', 'admin_officer', '20000000-0000-0000-0000-000000000001'),
  ('30000000-0000-0000-0000-000000000003', 'manager.lagos@kuun.test', 'Mo Manager', 'branch_operations', 'branch_manager', '20000000-0000-0000-0000-000000000001'),
  ('30000000-0000-0000-0000-000000000004', 'head.admin@kuun.test', 'Hadiza Head', 'administration', 'head_of_administration', null),
  ('30000000-0000-0000-0000-000000000005', 'auditor@kuun.test', 'Ade Auditor', 'internal_audit', 'internal_auditor', null);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
select
  '00000000-0000-0000-0000-000000000000', id, 'authenticated', 'authenticated', email,
  extensions.crypt('Password123!', extensions.gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now(),
  '', '', '', ''
from seed_staff;

insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), id, id::text,
  jsonb_build_object('sub', id::text, 'email', email, 'email_verified', true),
  'email', now(), now(), now()
from seed_staff;

insert into public.staff (id, full_name, email, department_code, home_branch_id)
select id, full_name, email, department, branch from seed_staff;

insert into public.staff_roles (staff_id, role_code, branch_id)
select id, role, branch from seed_staff;
drop table seed_staff;
