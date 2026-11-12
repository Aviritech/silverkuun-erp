-- Silverkuun ERP: regions, branches, bank accounts and a test login for every role.
-- Run after 01-schema.sql, on a NEW project. Run it once.
--
-- Every login below uses the password:  Kuun@Test2026
-- The logins are created straight in Supabase Auth (auth.users + auth.identities), already email-confirmed, so
-- nobody needs an invite email. Change or delete them before real staff use the system.

-- ---------------------------------------------------------------------------
-- Regions and branches
-- ---------------------------------------------------------------------------

insert into public.regions (id, code, name) values
  ('10000000-0000-0000-0000-000000000001', 'ABJ', 'Abuja'),
  ('10000000-0000-0000-0000-000000000002', 'LAG', 'Lagos'),
  ('10000000-0000-0000-0000-000000000003', 'PHC', 'Port Harcourt');

insert into public.branches (id, region_id, code, name) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'MBM', 'Mabushi Main'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'MBA', 'Mabushi Annex'),
  ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'UTK', 'Utako'),
  ('20000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', 'KBW', 'Kubwa'),
  ('20000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000002', 'IKJ', 'Ikeja'),
  ('20000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000002', 'IKY', 'Ikoyi'),
  ('20000000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-000000000002', 'YAB', 'Yaba'),
  ('20000000-0000-0000-0000-000000000008', '10000000-0000-0000-0000-000000000002', 'FST', 'Festac'),
  ('20000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-000000000003', 'ABR', 'Aba Road'),
  ('20000000-0000-0000-0000-000000000010', '10000000-0000-0000-0000-000000000003', 'POD', 'Peter Odili');

-- ---------------------------------------------------------------------------
-- A bank account and a cash account for every branch. Each bank account has its own ledger account under 1130
-- (codes 1131-1139, and 1160 for the tenth, since codes are four digits and 1140 is already taken).
-- Bank accounts: 40000000-...-0000000000NN (NN = branch number). Cash accounts: 41000000-...-0000000000NN.
-- ---------------------------------------------------------------------------

create temporary table seed_banks (n int, bank text, account_no text, ledger text);
insert into seed_banks values
  (1, 'Zenith Bank', '1012340001', '1131'), (2, 'Zenith Bank', '1012340002', '1132'),
  (3, 'GTBank', '0123400003', '1133'), (4, 'GTBank', '0123400004', '1134'),
  (5, 'Access Bank', '0690000005', '1135'), (6, 'Access Bank', '0690000006', '1136'),
  (7, 'First Bank', '3012300007', '1137'), (8, 'First Bank', '3012300008', '1138'),
  (9, 'UBA', '2030000009', '1139'), (10, 'UBA', '2030000010', '1160');

insert into public.ledger_accounts (code, name, account_type, parent_code, cash_flow_class, description)
select s.ledger, s.bank || ' - ' || b.name, 'asset', '1130', 'cash', b.name || ' branch operating account'
from seed_banks s join public.branches b on b.id = ('20000000-0000-0000-0000-0000000000' || lpad(s.n::text, 2, '0'))::uuid;

insert into public.bank_accounts (id, branch_id, name, kind, bank_name, account_number, ledger_account_code)
select ('40000000-0000-0000-0000-0000000000' || lpad(s.n::text, 2, '0'))::uuid, b.id, s.bank || ' ' || b.name || ' operations',
       'bank', s.bank, s.account_no, s.ledger
from seed_banks s join public.branches b on b.id = ('20000000-0000-0000-0000-0000000000' || lpad(s.n::text, 2, '0'))::uuid;

insert into public.bank_accounts (id, branch_id, name, kind, bank_name, account_number, ledger_account_code)
select ('41000000-0000-0000-0000-0000000000' || lpad(s.n::text, 2, '0'))::uuid, b.id, b.name || ' cash on hand', 'cash', null, null, '1110'
from seed_banks s join public.branches b on b.id = ('20000000-0000-0000-0000-0000000000' || lpad(s.n::text, 2, '0'))::uuid;
drop table seed_banks;

-- ---------------------------------------------------------------------------
-- Staff logins. scope: 'org' = whole organisation, 'branch' = one branch, 'region' = every branch in a region.
-- ---------------------------------------------------------------------------

create temporary table seed_staff (id uuid, email text, full_name text, department text, role text, scope text, scope_code text);
insert into seed_staff values
  -- Organisation-wide roles
  ('30000000-0000-0000-0000-000000000001', 'sysadmin@kuun.test',       'Sani Sysadmin',        'system',            'system_admin',           'org', null),
  ('30000000-0000-0000-0000-000000000002', 'head.ops@kuun.test',       'Hadiza Head of Ops',   'administration',    'head_of_administration', 'org', null),
  ('30000000-0000-0000-0000-000000000003', 'auditor@kuun.test',        'Ade Auditor',          'internal_audit',    'internal_auditor',       'org', null),
  ('30000000-0000-0000-0000-000000000004', 'controller@kuun.test',     'Fola Controller',      'accounts',          'financial_controller',   'org', null),
  ('30000000-0000-0000-0000-000000000005', 'analyst@kuun.test',        'Ngozi Analyst',        'credit',            'credit_analyst',         'org', null),
  ('30000000-0000-0000-0000-000000000006', 'head.credit@kuun.test',    'Uche Head of Credit',  'credit',            'credit_manager',         'org', null),
  ('30000000-0000-0000-0000-000000000007', 'head.business@kuun.test',  'Bayo Head of Business','management',        'head_of_business',       'org', null),
  ('30000000-0000-0000-0000-000000000008', 'head.hr@kuun.test',        'Kunle Head of HR',     'hr',                'head_of_hr',             'org', null),
  ('30000000-0000-0000-0000-000000000009', 'payroll@kuun.test',        'Pat Payroll',          'hr',                'payroll_officer',        'org', null),
  -- Accounts: the payments desk pays for every branch; regional accountants and receipts accountants work a region
  ('30000000-0000-0000-0000-000000000010', 'payments@kuun.test',       'Pius Payments',        'accounts',          'payments_accountant',    'branch', 'MBM'),
  ('30000000-0000-0000-0000-000000000011', 'accountant.abuja@kuun.test','Aisha Accountant',    'accounts',          'regional_accountant',    'region', 'ABJ'),
  ('30000000-0000-0000-0000-000000000012', 'accountant.lagos@kuun.test','Lola Accountant',     'accounts',          'regional_accountant',    'region', 'LAG'),
  ('30000000-0000-0000-0000-000000000013', 'accountant.ph@kuun.test',  'Tari Accountant',      'accounts',          'regional_accountant',    'region', 'PHC'),
  ('30000000-0000-0000-0000-000000000014', 'receipts.abuja@kuun.test', 'Rita Receipts',        'accounts',          'receipts_accountant',    'region', 'ABJ'),
  ('30000000-0000-0000-0000-000000000015', 'receipts.lagos@kuun.test', 'Rotimi Receipts',      'accounts',          'receipts_accountant',    'region', 'LAG'),
  -- Marketers and credit account officers cover a region
  ('30000000-0000-0000-0000-000000000016', 'marketer.abuja@kuun.test', 'Maryam Marketer',      'administration',    'marketer',               'region', 'ABJ'),
  ('30000000-0000-0000-0000-000000000017', 'marketer.lagos@kuun.test', 'Mariam Marketer',      'administration',    'marketer',               'region', 'LAG'),
  ('30000000-0000-0000-0000-000000000018', 'marketer.ph@kuun.test',    'Miebi Marketer',       'administration',    'marketer',               'region', 'PHC'),
  ('30000000-0000-0000-0000-000000000019', 'credit.abuja@kuun.test',   'Bello Account Officer','credit',            'credit_officer',         'region', 'ABJ'),
  ('30000000-0000-0000-0000-000000000020', 'credit.lagos@kuun.test',   'Kemi Account Officer', 'credit',            'credit_officer',         'region', 'LAG'),
  ('30000000-0000-0000-0000-000000000021', 'credit.ph@kuun.test',      'Ibim Account Officer', 'credit',            'credit_officer',         'region', 'PHC'),
  ('30000000-0000-0000-0000-000000000022', 'hr.abuja@kuun.test',       'Halima HR Officer',    'hr',                'hr_officer',             'branch', 'MBM'),
  ('30000000-0000-0000-0000-000000000023', 'hr.lagos@kuun.test',       'Hauwa HR Officer',     'hr',                'hr_officer',             'branch', 'IKJ'),
  -- An Operations Officer and a Branch Manager in every branch
  ('30000000-0000-0000-0000-000000000101', 'officer.mabushi@kuun.test',  'Ola Officer',        'administration',    'admin_officer',  'branch', 'MBM'),
  ('30000000-0000-0000-0000-000000000102', 'officer.annex@kuun.test',    'Obinna Officer',     'administration',    'admin_officer',  'branch', 'MBA'),
  ('30000000-0000-0000-0000-000000000103', 'officer.utako@kuun.test',    'Omolara Officer',    'administration',    'admin_officer',  'branch', 'UTK'),
  ('30000000-0000-0000-0000-000000000104', 'officer.kubwa@kuun.test',    'Osas Officer',       'administration',    'admin_officer',  'branch', 'KBW'),
  ('30000000-0000-0000-0000-000000000105', 'officer.ikeja@kuun.test',    'Oye Officer',        'administration',    'admin_officer',  'branch', 'IKJ'),
  ('30000000-0000-0000-0000-000000000106', 'officer.ikoyi@kuun.test',    'Onyeka Officer',     'administration',    'admin_officer',  'branch', 'IKY'),
  ('30000000-0000-0000-0000-000000000107', 'officer.yaba@kuun.test',     'Ope Officer',        'administration',    'admin_officer',  'branch', 'YAB'),
  ('30000000-0000-0000-0000-000000000108', 'officer.festac@kuun.test',   'Oge Officer',        'administration',    'admin_officer',  'branch', 'FST'),
  ('30000000-0000-0000-0000-000000000109', 'officer.abaroad@kuun.test',  'Owanate Officer',    'administration',    'admin_officer',  'branch', 'ABR'),
  ('30000000-0000-0000-0000-000000000110', 'officer.odili@kuun.test',    'Oyinye Officer',     'administration',    'admin_officer',  'branch', 'POD'),
  ('30000000-0000-0000-0000-000000000201', 'manager.mabushi@kuun.test',  'Musa Manager',       'branch_operations', 'branch_manager', 'branch', 'MBM'),
  ('30000000-0000-0000-0000-000000000202', 'manager.annex@kuun.test',    'Maimuna Manager',    'branch_operations', 'branch_manager', 'branch', 'MBA'),
  ('30000000-0000-0000-0000-000000000203', 'manager.utako@kuun.test',    'Mohammed Manager',   'branch_operations', 'branch_manager', 'branch', 'UTK'),
  ('30000000-0000-0000-0000-000000000204', 'manager.kubwa@kuun.test',    'Mercy Manager',      'branch_operations', 'branch_manager', 'branch', 'KBW'),
  ('30000000-0000-0000-0000-000000000205', 'manager.ikeja@kuun.test',    'Mo Manager',         'branch_operations', 'branch_manager', 'branch', 'IKJ'),
  ('30000000-0000-0000-0000-000000000206', 'manager.ikoyi@kuun.test',    'Moji Manager',       'branch_operations', 'branch_manager', 'branch', 'IKY'),
  ('30000000-0000-0000-0000-000000000207', 'manager.yaba@kuun.test',     'Modupe Manager',     'branch_operations', 'branch_manager', 'branch', 'YAB'),
  ('30000000-0000-0000-0000-000000000208', 'manager.festac@kuun.test',   'Mike Manager',       'branch_operations', 'branch_manager', 'branch', 'FST'),
  ('30000000-0000-0000-0000-000000000209', 'manager.abaroad@kuun.test',  'Minaibim Manager',   'branch_operations', 'branch_manager', 'branch', 'ABR'),
  ('30000000-0000-0000-0000-000000000210', 'manager.odili@kuun.test',    'Mina Manager',       'branch_operations', 'branch_manager', 'branch', 'POD');

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, email_change_token_current, recovery_token,
  phone_change, phone_change_token, reauthentication_token
)
select
  '00000000-0000-0000-0000-000000000000', id, 'authenticated', 'authenticated', email,
  extensions.crypt('Kuun@Test2026', extensions.gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}', jsonb_build_object('full_name', full_name), now(), now(),
  '', '', '', '', '', '', '', ''
from seed_staff;

insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), id, id::text,
  jsonb_build_object('sub', id::text, 'email', email, 'email_verified', true),
  'email', now(), now(), now()
from seed_staff;

-- Home branch: the branch of a branch role; the region's first branch for a regional role; Mabushi Main otherwise.
insert into public.staff (id, full_name, email, department_code, home_branch_id)
select s.id, s.full_name, s.email, s.department,
       coalesce(
         (select b.id from public.branches b where s.scope = 'branch' and b.code = s.scope_code),
         (select b.id from public.branches b join public.regions r on r.id = b.region_id
           where s.scope = 'region' and r.code = s.scope_code order by b.code limit 1),
         '20000000-0000-0000-0000-000000000001')
from seed_staff s;

insert into public.staff_roles (staff_id, role_code, branch_id, region_id)
select s.id, s.role,
       (select b.id from public.branches b where s.scope = 'branch' and b.code = s.scope_code),
       (select r.id from public.regions r where s.scope = 'region' and r.code = s.scope_code)
from seed_staff s;
drop table seed_staff;

-- What was created.
select r.name as region, b.code, b.name as branch,
       (select string_agg(st.email, ', ' order by st.email) from public.staff_roles sr join public.staff st on st.id = sr.staff_id
         where sr.branch_id = b.id) as branch_logins
from public.branches b join public.regions r on r.id = b.region_id
order by r.name, b.name;
