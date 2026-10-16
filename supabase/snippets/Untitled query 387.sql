insert into regions (code, name) values ('HQ', 'Head Office');
insert into branches (region_id, code, name) select id, 'HQ', 'Head Office' from regions;
insert into staff (id, full_name, email, department_code)
  select id, 'Sosa Test', email, 'system' from auth.users where email = 'you@example.com';
insert into staff_roles (staff_id, role_code)
  select id, r from staff, unnest(array['system_admin','admin_officer','internal_auditor']) r
  where email = 'you@example.com';