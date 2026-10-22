-- Department renames: Administration is now Operations, and Human Resources is now HR/Admin.
-- Only the names people see change. Codes ('administration', 'hr'), permissions and URLs stay the same, so existing
-- role assignments and records are untouched.

update public.departments set name = 'Operations' where code = 'administration';
update public.departments set name = 'HR/Admin' where code = 'hr';

update public.permissions set description = 'Open the Operations module' where code = 'module.administration';
update public.permissions set description = 'Open the HR/Admin module' where code = 'module.hr';

update public.roles set name = 'Operations Officer' where code = 'admin_officer';
update public.roles set name = 'Head of Operations' where code = 'head_of_administration';
