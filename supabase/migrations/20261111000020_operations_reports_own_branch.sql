-- Operations reports: only the Head of Operations sees every branch. Everyone else who opens the Operations reports
-- (Operations Officers, Branch Managers, marketers, credit staff, auditors) sees their own branch only: the branch
-- their role is assigned to, or their home branch if the role was given organisation-wide.
-- Safe to run twice.

insert into public.permissions (code, description) values
  ('reports.all_branches', 'Run Operations reports for every branch')
on conflict (code) do nothing;

insert into public.role_permissions (role_code, permission_code) values
  ('head_of_administration', 'reports.all_branches')
on conflict do nothing;
