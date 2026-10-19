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
  ('30000000-0000-0000-0000-000000000005', 'auditor@kuun.test', 'Ade Auditor', 'internal_audit', 'internal_auditor', null),
  ('30000000-0000-0000-0000-000000000006', 'accountant.lagos@kuun.test', 'Lola Accountant', 'accounts', 'regional_accountant', '20000000-0000-0000-0000-000000000001'),
  ('30000000-0000-0000-0000-000000000007', 'receipts.abuja@kuun.test', 'Rita Receipts', 'accounts', 'receipts_accountant', '20000000-0000-0000-0000-000000000002'),
  ('30000000-0000-0000-0000-000000000008', 'payments.abuja@kuun.test', 'Pius Payments', 'accounts', 'payments_accountant', '20000000-0000-0000-0000-000000000002'),
  ('30000000-0000-0000-0000-000000000009', 'controller@kuun.test', 'Fola Controller', 'accounts', 'financial_controller', null);

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

-- ---------------------------------------------------------------------------
-- Demo records, created through the real workflow functions so every rule and audit entry applies.
-- Uploaded documents are placeholders: the rows exist but no file is stored behind them.
-- ---------------------------------------------------------------------------

-- Bank and cash accounts.
insert into public.ledger_accounts (code, name, account_type, parent_code, cash_flow_class, description) values
  ('1131', 'Zenith Bank - Lagos operations', 'asset', '1130', 'cash', 'Lagos branch operating account'),
  ('1132', 'GTBank - Abuja operations', 'asset', '1130', 'cash', 'Abuja branch operating account');

insert into public.bank_accounts (id, branch_id, name, kind, bank_name, account_number, ledger_account_code) values
  ('40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Zenith Lagos operations', 'bank', 'Zenith Bank', '1012345678', '1131'),
  ('40000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 'GTBank Abuja operations', 'bank', 'GTBank', '0123456789', '1132'),
  ('40000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000001', 'Lagos cash on hand', 'cash', null, null, '1110'),
  ('40000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000002', 'Abuja cash on hand', 'cash', null, null, '1110');

create function pg_temp.act_as(p_email text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', (select id::text from public.staff where email = p_email), false);
$$;

create function pg_temp.add_docs(p_member uuid, p_types text[]) returns void language sql as $$
  insert into public.member_documents (member_id, branch_id, document_type, file_name, storage_path, mime_type, size_bytes)
  select m.id, m.branch_id, t::public.member_document_type, t || '.pdf', m.branch_id || '/' || m.id || '/seed-' || t || '.pdf',
         'application/pdf', 1024
  from public.members m, unnest(p_types) t where m.id = p_member;
$$;

-- Members in Lagos: two approved, one awaiting the Branch Manager, one incomplete draft.
select pg_temp.act_as('officer.lagos@kuun.test');
insert into public.members (id, branch_id, title, first_name, last_name, gender, phone, email, address, nin, id_type, id_number, created_at) values
  ('50000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Mrs', 'Ada', 'Obi', 'female', '08031234567', 'ada.obi@example.com', '12 Marina, Lagos Island', '12345678901', 'national_id', 'NG-A001', now()),
  ('50000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', 'Mr', 'Chinedu', 'Okeke', 'male', '08039876543', null, '4 Allen Avenue, Ikeja', '12345678902', 'drivers_licence', 'LAG-DL-22', now()),
  ('50000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000001', 'Ms', 'Funke', 'Adeyemi', 'female', '08025551234', null, '9 Bode Thomas, Surulere', '12345678903', 'international_passport', 'A09876543', now()),
  ('50000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000001', 'Mr', 'Tunde', 'Balogun', 'male', '08024443322', null, '3 Adeola Odeku, VI', '12345678904', 'voters_card', 'VC-7781', now() - interval '20 days');
select pg_temp.add_docs(id, array['kyc_form', 'nin_slip', 'means_of_id', 'utility_bill', 'passport_photo'])
from public.members where id in ('50000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000003');
select pg_temp.add_docs('50000000-0000-0000-0000-000000000004', array['kyc_form', 'nin_slip']);
select public.submit_member(id)
from public.members where id in ('50000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000003');

select pg_temp.act_as('manager.lagos@kuun.test');
-- A placeholder drawn signature, standing in for what the Branch Manager signs on screen.
create temporary table seed_signature as select 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAPAAAABGCAYAAADyxhn6AAACr0lEQVR42u3dSW7kMAxAUR8jQN//nOoLNNCxLNoc3uLvgnJc0pdIaqjr5+fPBaAmvgSAwAAIDIDAAIEBEBgAgQEQGCAwAAIDIDBAYAAEBkBgAAQGCAyAwAAIDIDAAIHLs/6BTgECF5WXxCBwcXlX83fU6QncXuAlugCBa+W9UwQmMYFbde5uBa01IMJQgBwq8P8avKPA17AIg8BNCzVrgMBrgMDSgyYC323I3zZ05Q4xMcIYL/GEPG8RuHWEsfteLeTvLPDOCF21QScPUDsitpnBu1eSTzQugfNXnZ8M0gROHCbuNE61BhVh7P9NeYm7CXxiG2GGxozM23c/N9P3cbJvXATOOdtUeM7T/CwqRcg0Qz0ZcHaX2RaBa0v1VWPeDe8iooxVVOA7M2ybKj2B6wm8DswaTwuB6+C7nW6H3f/95HLUa/3mVGd7u3N3GzDuzh5PO8uOqFECryQCRzwvvE9XEWoNFDg6rN35zIhZKtOseHI9+e7zCJyo4r0SP+vJZ0bNiCfz+6eFqadFs+jBKUTgKTlpVKX2q7XcL2ap3z47Y5uf3Bk2VuCM+287rD2/WRXOvC574nTba1Vva7KxlWE7v87sjqp4MCQyPTi2jETg541j73W+bY1PZ9cTOfLrAq9m4fOp3VEV3u+rrY2ZTwedyM3Do4tM+VD22Smi0NP1dFDX88enjy6WEdj53FkXCEy5JPDznVoZjvi5IcMdXN0v0Asb0DLsIJrSwSfcUdVp9s14rDLsMMOdtVK3RLpkDskF3llumXDRercQ8yLwHIFH3JAQVMmckCfi4/PAJ4pU0zp4519DJFjBA/3p1skIXDYqeQMCC8PKVTIXCCwMIw+BCUwgAoHABCYQgQlMHhC4jsA6AAgMgMAACAwQGACBARAYAIEBAgMgMAACA+P5C0FOeCPvj+R4AAAAAElFTkSuQmCC'::text as png;
select public.approve_member('50000000-0000-0000-0000-000000000001', (select png from seed_signature));
select public.approve_member('50000000-0000-0000-0000-000000000002', (select png from seed_signature));

-- Plans and contributions.
select pg_temp.act_as('officer.lagos@kuun.test');
insert into public.member_plans (id, member_id, branch_id, plan_type, contribution_amount, contribution_frequency, start_date, maturity_date) values
  ('60000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'gold', 50000, 'monthly', current_date - 60, current_date + 305),
  ('60000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', 'silver', 20000, 'monthly', current_date - 30, current_date + 335);
insert into public.contributions (id, member_plan_id, member_id, branch_id, kind, amount, paid_on, payment_method, reference) values
  ('70000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'scheduled', 50000, current_date - 10, 'bank_transfer', 'TRF-ADA-001'),
  ('70000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'top_up', 25000, current_date - 5, 'bank_transfer', 'TRF-ADA-002'),
  ('70000000-0000-0000-0000-000000000003', '60000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', 'scheduled', 20000, current_date - 8, 'bank_transfer', 'TRF-CHI-001'),
  ('70000000-0000-0000-0000-000000000004', '60000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', 'scheduled', 20000, current_date - 1, 'cash', null);

select pg_temp.act_as('manager.lagos@kuun.test');
select public.verify_contribution(id) from public.contributions
where id in ('70000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-000000000003');

-- Opening balances, prepared by an accountant and posted by the Financial Controller.
select pg_temp.act_as('accountant.lagos@kuun.test');
insert into public.journal_entries (id, branch_id, entry_date, description) values
  ('80000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', current_date - 30, 'Opening balances at cutover - Lagos');
insert into public.journal_lines (entry_id, line_no, branch_id, account_code, debit, credit) values
  ('80000000-0000-0000-0000-000000000001', 1, '20000000-0000-0000-0000-000000000001', '1131', 5000000, 0),
  ('80000000-0000-0000-0000-000000000001', 2, '20000000-0000-0000-0000-000000000001', '1110', 150000, 0),
  ('80000000-0000-0000-0000-000000000001', 3, '20000000-0000-0000-0000-000000000001', '3200', 0, 5150000);
select pg_temp.act_as('controller@kuun.test');
select public.post_journal_entry('80000000-0000-0000-0000-000000000001');

-- Ada's verified contributions become receipts in Accounts.
select pg_temp.act_as('accountant.lagos@kuun.test');
insert into public.finance_transactions (id, direction, transaction_type, txn_date, amount, bank_account_id, member_id, reference, description, contribution_id, branch_id)
values
  ('90000000-0000-0000-0000-000000000001', 'receipt', 'member_savings', current_date - 10, 50000, '40000000-0000-0000-0000-000000000001',
   '50000000-0000-0000-0000-000000000001', 'TRF-ADA-001', 'Gold plan contribution', '70000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001');
select public.submit_finance_transaction('90000000-0000-0000-0000-000000000001');

-- Office rent: requested, approved, paid with proof.
insert into public.finance_transactions (id, direction, transaction_type, txn_date, amount, bank_account_id, counterparty, reference, description, branch_id)
values
  ('90000000-0000-0000-0000-000000000002', 'payment', 'admin_expense', current_date - 7, 350000, '40000000-0000-0000-0000-000000000001',
   'Marina Properties Ltd', 'INV-2026-114', 'Lagos office rent for the month', '20000000-0000-0000-0000-000000000001');
insert into public.finance_attachments (transaction_id, branch_id, kind, file_name, storage_path, mime_type, size_bytes)
values ('90000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', 'supporting', 'rent-invoice.pdf',
        '20000000-0000-0000-0000-000000000001/90000000-0000-0000-0000-000000000002/seed-invoice.pdf', 'application/pdf', 1024);
select public.submit_finance_transaction('90000000-0000-0000-0000-000000000002');

select pg_temp.act_as('controller@kuun.test');
select public.approve_finance_transaction('90000000-0000-0000-0000-000000000001');
select public.approve_finance_transaction('90000000-0000-0000-0000-000000000002');

select pg_temp.act_as('accountant.lagos@kuun.test');
insert into public.finance_attachments (transaction_id, branch_id, kind, file_name, storage_path, mime_type, size_bytes)
values ('90000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', 'payment_proof', 'transfer-receipt.pdf',
        '20000000-0000-0000-0000-000000000001/90000000-0000-0000-0000-000000000002/seed-proof.pdf', 'application/pdf', 1024);
select public.pay_finance_transaction('90000000-0000-0000-0000-000000000002');

-- An Abuja payment request waiting for approval.
select pg_temp.act_as('payments.abuja@kuun.test');
insert into public.finance_transactions (id, direction, transaction_type, txn_date, amount, bank_account_id, counterparty, reference, description, branch_id)
values
  ('90000000-0000-0000-0000-000000000003', 'payment', 'professional_fees', current_date - 2, 120000, '40000000-0000-0000-0000-000000000002',
   'Adewale & Co Chartered Accountants', 'INV-AC-0091', 'Quarterly bookkeeping review', '20000000-0000-0000-0000-000000000002');
insert into public.finance_attachments (transaction_id, branch_id, kind, file_name, storage_path, mime_type, size_bytes)
values ('90000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000002', 'supporting', 'engagement-letter.pdf',
        '20000000-0000-0000-0000-000000000002/90000000-0000-0000-0000-000000000003/seed-letter.pdf', 'application/pdf', 1024);
select public.submit_finance_transaction('90000000-0000-0000-0000-000000000003');

-- A Lagos bank statement: three lines match the books, a bank charge and an unknown deposit wait for review.
select pg_temp.act_as('accountant.lagos@kuun.test');
select public.import_bank_statement(
  '40000000-0000-0000-0000-000000000001', 'zenith-lagos-statement.csv', null, 'seed-statement-1',
  jsonb_build_array(
    jsonb_build_object('date', current_date - 30, 'description', 'OPENING BALANCE TRANSFER', 'reference', 'OPEN', 'amount', 5000000, 'balance', 5000000),
    jsonb_build_object('date', current_date - 10, 'description', 'TRF FROM ADA OBI', 'reference', 'TRF-ADA-001', 'amount', 50000, 'balance', 5050000),
    jsonb_build_object('date', current_date - 6, 'description', 'TRF TO MARINA PROPERTIES', 'reference', 'INV-2026-114', 'amount', -350000, 'balance', 4700000),
    jsonb_build_object('date', current_date - 6, 'description', 'SMS ALERT CHARGES', 'reference', null, 'amount', -1075, 'balance', 4698925),
    jsonb_build_object('date', current_date - 4, 'description', 'CASH DEPOSIT - UNKNOWN', 'reference', 'DEP-55120', 'amount', 75000, 'balance', 4773925)
  )
);
select public.auto_match_bank_lines('40000000-0000-0000-0000-000000000001');

-- A one-off plan maturing soon, so the maturities list has something to show.
select pg_temp.act_as('officer.lagos@kuun.test');
insert into public.member_plans (id, member_id, branch_id, plan_type, contribution_amount, contribution_frequency, start_date, maturity_date) values
  ('60000000-0000-0000-0000-000000000003', '50000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', 'platinum', 250000, 'one_off', current_date - 350, current_date + 15);
insert into public.contributions (id, member_plan_id, member_id, branch_id, kind, amount, paid_on, payment_method, reference) values
  ('70000000-0000-0000-0000-000000000005', '60000000-0000-0000-0000-000000000003', '50000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', 'scheduled', 250000, current_date - 350, 'bank_transfer', 'TRF-CHI-FD1');

-- This month's branch targets, set by the Head of Administration.
select pg_temp.act_as('head.admin@kuun.test');
insert into public.branch_targets (branch_id, month, registrations, collections) values
  ('20000000-0000-0000-0000-000000000001', date_trunc('month', current_date)::date, 8, 400000),
  ('20000000-0000-0000-0000-000000000002', date_trunc('month', current_date)::date, 5, 250000);

-- Suppliers, and a Lagos diesel bill approved by the Financial Controller and not yet paid.
select pg_temp.act_as('accountant.lagos@kuun.test');
insert into public.suppliers (id, name, contact_person, phone, bank_name, account_number) values
  ('a0000000-0000-0000-0000-000000000001', 'Marina Properties Ltd', 'Bola Ade', '08011112222', 'Access Bank', '0690000011'),
  ('a0000000-0000-0000-0000-000000000002', 'PowerGen Diesel Supplies', 'Emeka Nwosu', '08033334444', 'First Bank', '3012345678');
insert into public.supplier_bills (id, bill_no, supplier_id, branch_id, department_code, bill_date, due_date, supplier_reference,
  expense_account, amount, description) values
  ('a1000000-0000-0000-0000-000000000001', 'pending', 'a0000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001',
   'administration', current_date - 20, current_date - 5, 'PG-4471', '5300', 85000, 'Diesel for the Lagos office generator');
insert into public.finance_attachments (supplier_bill_id, branch_id, kind, file_name, storage_path, mime_type, size_bytes)
values ('a1000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'supporting', 'powergen-invoice.pdf',
        '20000000-0000-0000-0000-000000000001/bills/a1000000-0000-0000-0000-000000000001/seed-invoice.pdf', 'application/pdf', 1024);
select public.submit_supplier_bill('a1000000-0000-0000-0000-000000000001');

-- A posting rule change proposed by the accountant, waiting for the Financial Controller.
insert into public.posting_rule_changes (transaction_type, debit_account, requires_member, is_active, reason)
values ('bank_charges', '5800', false, true, 'Report bank charges under other operating expenses until they have their own budget line');

select pg_temp.act_as('controller@kuun.test');
select public.approve_supplier_bill('a1000000-0000-0000-0000-000000000001');

select set_config('request.jwt.claim.sub', '', false);

-- Age a few demo records so the Internal Audit exception checks have something to show on a fresh database.
-- Triggers are off for these three updates only, so the audit trail keeps the original history.
set session_replication_role = replica;
update public.members set created_at = now() - interval '10 days', submitted_at = now() - interval '9 days' where id = '50000000-0000-0000-0000-000000000003';
update public.finance_transactions set created_at = now() - interval '4 days', submitted_at = now() - interval '4 days' where id = '90000000-0000-0000-0000-000000000003';
update public.bank_statement_lines set line_date = current_date - 18
where bank_account_id = '40000000-0000-0000-0000-000000000001' and reference = 'DEP-55120';
set session_replication_role = origin;
