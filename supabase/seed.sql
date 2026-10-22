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
  ('30000000-0000-0000-0000-000000000009', 'controller@kuun.test', 'Fola Controller', 'accounts', 'financial_controller', null),
  ('30000000-0000-0000-0000-000000000010', 'credit.lagos@kuun.test', 'Kemi Account Officer', 'credit', 'credit_officer', '20000000-0000-0000-0000-000000000001'),
  ('30000000-0000-0000-0000-000000000011', 'credit.abuja@kuun.test', 'Bello Account Officer', 'credit', 'credit_officer', '20000000-0000-0000-0000-000000000002'),
  ('30000000-0000-0000-0000-000000000012', 'analyst@kuun.test', 'Ngozi Analyst', 'credit', 'credit_analyst', null),
  ('30000000-0000-0000-0000-000000000013', 'head.credit@kuun.test', 'Uche Head of Credit', 'credit', 'credit_manager', null),
  ('30000000-0000-0000-0000-000000000014', 'hr.lagos@kuun.test', 'Halima HR Officer', 'hr', 'hr_officer', '20000000-0000-0000-0000-000000000001'),
  ('30000000-0000-0000-0000-000000000015', 'head.hr@kuun.test', 'Kunle Head of HR', 'hr', 'head_of_hr', null),
  ('30000000-0000-0000-0000-000000000016', 'payroll@kuun.test', 'Pat Payroll', 'hr', 'payroll_officer', null);

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

-- ---------------------------------------------------------------------------
-- Credit: loans at every stage, raised by the Lagos account officer, appraised by the analyst, decided by the
-- Head of Credit, and paid out and repaid through Accounts.
-- ---------------------------------------------------------------------------

create function pg_temp.new_loan(p_id uuid, p_member uuid, p_product text, p_amount numeric, p_tenor int, p_method text, p_rate numeric,
  p_category text, p_purpose text) returns void language sql as $$
  insert into public.loans (id, branch_id, member_id, product_code, phone, address, customer_category, employer_name, occupation,
    monthly_income, amount_requested, purpose, tenor_months, repayment_frequency, interest_rate, rate_basis, interest_method, repayment_mode)
  select p_id, m.branch_id, m.id, p_product, m.phone, m.address, p_category,
         case when p_category = 'salary_earner' then 'Lagos State Ministry of Education' else 'Okeke Building Supplies' end,
         case when p_category = 'salary_earner' then 'Teacher' else 'Building materials trader' end,
         case when p_category = 'salary_earner' then 420000 else 900000 end,
         p_amount, p_purpose, p_tenor, 'monthly', p_rate, 'per_month', p_method,
         case when p_category = 'salary_earner' then 'salary_deduction' else 'bank_transfer' end
  from public.members m where m.id = p_member;
  insert into public.loan_documents (loan_id, branch_id, document_type, file_name, storage_path, mime_type, size_bytes)
  select p_id, l.branch_id, 'application_form', 'application-form.pdf', l.branch_id || '/' || l.id || '/seed-form.pdf', 'application/pdf', 1024
  from public.loans l where l.id = p_id;
  insert into public.loan_guarantors (loan_id, branch_id, full_name, phone, address, relationship, occupation, monthly_income)
  select p_id, l.branch_id, 'Bayo Adewale', '08035550101', '7 Awolowo Road, Ikoyi', 'Colleague', 'Civil servant', 380000
  from public.loans l where l.id = p_id;
$$;

create function pg_temp.approve_loan(p_id uuid, p_amount numeric) returns void language sql as $$
  select public.submit_loan(p_id) from (select pg_temp.act_as('credit.lagos@kuun.test')) a;
  select public.appraise_loan(p_id, 'clear', 'CRC Credit Bureau', '702', 'low', 'approve', p_amount,
    'Steady income, no adverse bureau records, repayment within a third of monthly income.')
  from (select pg_temp.act_as('analyst@kuun.test')) a;
  select public.decide_loan(p_id, true, p_amount, null) from (select pg_temp.act_as('head.credit@kuun.test')) a;
$$;

-- Accounts pays the loan out: the accountant requests it, the controller approves, the accountant pays with proof.
create function pg_temp.disburse_loan(p_loan uuid, p_txn uuid, p_days_ago int) returns void language sql as $$
  select pg_temp.act_as('accountant.lagos@kuun.test');
  insert into public.finance_transactions (id, direction, transaction_type, txn_date, amount, bank_account_id, member_id, loan_id,
    counterparty, reference, description, branch_id)
  select p_txn, 'payment', 'loan_disbursement', current_date - p_days_ago, l.approved_amount, '40000000-0000-0000-0000-000000000001',
         l.member_id, l.id, 'Loan customer', 'DSB-' || l.loan_no, 'Disbursement of loan ' || l.loan_no, l.branch_id
  from public.loans l where l.id = p_loan;
  select public.submit_finance_transaction(p_txn);
  select pg_temp.act_as('controller@kuun.test');
  select public.approve_finance_transaction(p_txn);
  select pg_temp.act_as('accountant.lagos@kuun.test');
  insert into public.finance_attachments (transaction_id, branch_id, kind, file_name, storage_path, mime_type, size_bytes)
  select p_txn, branch_id, 'payment_proof', 'transfer-receipt.pdf', branch_id || '/' || p_txn || '/seed-proof.pdf', 'application/pdf', 1024
  from public.finance_transactions where id = p_txn;
  select public.pay_finance_transaction(p_txn);
$$;

-- A repayment receipted by the accountant and confirmed by the controller. A null amount pays off everything owed.
create function pg_temp.repay_loan(p_loan uuid, p_txn uuid, p_amount numeric, p_days_ago int) returns void language sql as $$
  select pg_temp.act_as('accountant.lagos@kuun.test');
  insert into public.finance_transactions (id, direction, transaction_type, txn_date, amount, bank_account_id, member_id, loan_id,
    reference, description, branch_id)
  select p_txn, 'receipt', 'loan_repayment', current_date - p_days_ago,
         coalesce(p_amount, (select b.outstanding_principal + b.outstanding_interest from public.loan_book b where b.id = l.id)),
         '40000000-0000-0000-0000-000000000001', l.member_id, l.id, 'RPY-' || right(p_txn::text, 4), 'Repayment on loan ' || l.loan_no, l.branch_id
  from public.loans l where l.id = p_loan;
  insert into public.finance_attachments (transaction_id, branch_id, kind, file_name, storage_path, mime_type, size_bytes)
  select p_txn, branch_id, 'supporting', 'teller.pdf', branch_id || '/' || p_txn || '/seed-teller.pdf', 'application/pdf', 1024
  from public.finance_transactions where id = p_txn;
  select public.submit_finance_transaction(p_txn);
  select pg_temp.act_as('controller@kuun.test');
  select public.approve_finance_transaction(p_txn);
$$;

select pg_temp.act_as('credit.lagos@kuun.test');
select pg_temp.new_loan('b0000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 'personal', 300000, 6, 'flat', 2.5,
  'salary_earner', 'School fees for the new term');
select pg_temp.new_loan('b0000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000002', 'business', 1000000, 12, 'reducing_balance', 3,
  'business_owner', 'Restock cement and roofing sheets ahead of the dry season');
insert into public.loan_collaterals (loan_id, branch_id, collateral_type, description, estimated_value, valuation_date, valued_by)
values ('b0000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', 'vehicle', '2016 Toyota Hilux, LAG-482-KJ',
        6500000, current_date - 110, 'Ade & Partners Valuers');
select pg_temp.new_loan('b0000000-0000-0000-0000-000000000003', '50000000-0000-0000-0000-000000000001', 'salary_advance', 100000, 3, 'flat', 5,
  'salary_earner', 'Medical bills');
select pg_temp.new_loan('b0000000-0000-0000-0000-000000000004', '50000000-0000-0000-0000-000000000002', 'personal', 200000, 6, 'flat', 2.5,
  'business_owner', 'Rent for the shop');
select pg_temp.new_loan('b0000000-0000-0000-0000-000000000005', '50000000-0000-0000-0000-000000000001', 'asset', 450000, 10, 'flat', 2.5,
  'salary_earner', 'A laptop and printer for evening tutoring');
insert into public.loan_documents (loan_id, branch_id, document_type, file_name, storage_path, mime_type, size_bytes)
values ('b0000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000001', 'proforma_invoice', 'slot-proforma.pdf',
        '20000000-0000-0000-0000-000000000001/b0000000-0000-0000-0000-000000000005/seed-proforma.pdf', 'application/pdf', 1024);
select pg_temp.new_loan('b0000000-0000-0000-0000-000000000006', '50000000-0000-0000-0000-000000000002', 'personal', 150000, 4, 'flat', 2.5,
  'business_owner', 'Generator repairs');
select pg_temp.new_loan('b0000000-0000-0000-0000-000000000007', '50000000-0000-0000-0000-000000000001', 'business', 400000, 6, 'reducing_balance', 3,
  'self_employed', 'Equipment for a home bakery');

-- Active and on time for one instalment, then late: paid out 75 days ago, one repayment made.
select pg_temp.approve_loan('b0000000-0000-0000-0000-000000000001', 300000);
select pg_temp.disburse_loan('b0000000-0000-0000-0000-000000000001', '91000000-0000-0000-0000-000000000001', 75);
select pg_temp.repay_loan('b0000000-0000-0000-0000-000000000001', '91000000-0000-0000-0000-000000000002', 57500, 44);

-- Active and more than 30 days behind: paid out 100 days ago, one repayment made.
select pg_temp.approve_loan('b0000000-0000-0000-0000-000000000002', 1000000);
select pg_temp.disburse_loan('b0000000-0000-0000-0000-000000000002', '91000000-0000-0000-0000-000000000003', 100);
select pg_temp.repay_loan('b0000000-0000-0000-0000-000000000002', '91000000-0000-0000-0000-000000000004', 100462.09, 68);

-- Repaid in full.
select pg_temp.approve_loan('b0000000-0000-0000-0000-000000000003', 100000);
select pg_temp.disburse_loan('b0000000-0000-0000-0000-000000000003', '91000000-0000-0000-0000-000000000005', 120);
select pg_temp.repay_loan('b0000000-0000-0000-0000-000000000003', '91000000-0000-0000-0000-000000000006', 38333.33, 90);
select pg_temp.repay_loan('b0000000-0000-0000-0000-000000000003', '91000000-0000-0000-0000-000000000007', 38333.33, 60);
select pg_temp.repay_loan('b0000000-0000-0000-0000-000000000003', '91000000-0000-0000-0000-000000000008', null, 31);

-- Approved by the Head of Credit and waiting for Accounts to pay it out.
select pg_temp.approve_loan('b0000000-0000-0000-0000-000000000004', 180000);

-- Appraised and waiting for the Head of Credit.
select pg_temp.act_as('credit.lagos@kuun.test');
select public.submit_loan('b0000000-0000-0000-0000-000000000005');
select pg_temp.act_as('analyst@kuun.test');
select public.appraise_loan('b0000000-0000-0000-0000-000000000005', 'no_record', 'FirstCentral', null, 'medium', 'approve', 400000,
  'No credit history, but salary covers the instalment well. Recommend a slightly smaller amount.');

-- Submitted and waiting for the analyst.
select pg_temp.act_as('credit.lagos@kuun.test');
select public.submit_loan('b0000000-0000-0000-0000-000000000006');

-- The Lagos officer reminded Ada about her overdue instalment.
insert into public.loan_reminders (loan_id, branch_id, kind, channel, amount, note)
values ('b0000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'overdue', 'call', 57500, 'Promised to pay at month end');

-- ---------------------------------------------------------------------------
-- HR: employee records for some of the test accounts (linked to their logins), a driver with no login, and a new
-- starter whose probation and contract end soon.
-- ---------------------------------------------------------------------------

select pg_temp.act_as('head.hr@kuun.test');
insert into public.employees (id, employee_no, status, branch_id, department_code, job_title_id, employment_type, hire_date,
  first_name, last_name, gender, phone, work_email, address, nin, bank_name, bank_account_number)
select e.id, e.no, e.status::public.employee_status, e.branch, e.department, (select id from public.job_titles where name = e.title),
       e.kind, e.hired, e.first_name, e.last_name, e.gender, e.phone, e.email, e.address, e.nin, 'Zenith Bank', e.account
from (values
  ('c0000000-0000-0000-0000-000000000001'::uuid, 'SK-00001', 'active', '20000000-0000-0000-0000-000000000001'::uuid, 'hr', 'Head of HR', 'permanent', date '2019-03-01',
   'Kunle', 'Head of HR', 'male', '08031110001', 'head.hr@kuun.test', '5 Bourdillon Road, Ikoyi', '22222222201', '2010000001'),
  ('c0000000-0000-0000-0000-000000000002', 'SK-00002', 'active', '20000000-0000-0000-0000-000000000001', 'hr', 'HR Officer', 'permanent',
   date '2022-06-13', 'Halima', 'HR Officer', 'female', '08031110002', 'hr.lagos@kuun.test', '14 Ogunlana Drive, Surulere', '22222222202', '2010000002'),
  ('c0000000-0000-0000-0000-000000000003', 'SK-00003', 'active', '20000000-0000-0000-0000-000000000001', 'administration',
   'Administrative Officer', 'permanent', date '2021-01-11', 'Ola', 'Officer', 'female', '08031110003', 'officer.lagos@kuun.test',
   '22 Herbert Macaulay Way, Yaba', '22222222203', '2010000003'),
  ('c0000000-0000-0000-0000-000000000004', 'SK-00004', 'active', '20000000-0000-0000-0000-000000000001', 'branch_operations',
   'Branch Manager', 'permanent', date '2018-09-03', 'Mo', 'Manager', 'male', '08031110004', 'manager.lagos@kuun.test',
   '3 Awolowo Road, Ikoyi', '22222222204', '2010000004'),
  ('c0000000-0000-0000-0000-000000000005', 'SK-00005', 'active', '20000000-0000-0000-0000-000000000001', 'credit', 'Account Officer',
   'permanent', date '2023-02-20', 'Kemi', 'Account Officer', 'female', '08031110005', 'credit.lagos@kuun.test',
   '9 Adeniran Ogunsanya, Surulere', '22222222205', '2010000005'),
  ('c0000000-0000-0000-0000-000000000006', 'SK-00006', 'active', '20000000-0000-0000-0000-000000000002', 'administration', 'Supervisor',
   'permanent', date '2020-05-04', 'Danjuma', 'Bello', 'male', '08031110006', null, '12 Aminu Kano Crescent, Wuse 2', '22222222206', '2010000006'),
  ('c0000000-0000-0000-0000-000000000007', 'SK-00007', 'probation', '20000000-0000-0000-0000-000000000001', 'credit', 'Account Officer',
   'contract', current_date - 160, 'Tobi', 'Adewale', 'male', '08031110007', 'tobi.adewale@kuun.test', '7 Allen Avenue, Ikeja',
   '22222222207', '2010000007')
) as e(id, no, status, branch, department, title, kind, hired, first_name, last_name, gender, phone, email, address, nin, account);

update public.employees set probation_end_date = current_date + 20 where id = 'c0000000-0000-0000-0000-000000000007';

insert into public.employee_contracts (employee_id, contract_type, start_date, end_date) values
  ('c0000000-0000-0000-0000-000000000003', 'permanent', '2021-01-11', null),
  ('c0000000-0000-0000-0000-000000000004', 'permanent', '2018-09-03', null),
  ('c0000000-0000-0000-0000-000000000007', 'fixed_term', current_date - 160, current_date + 25);

insert into public.employee_qualifications (employee_id, kind, qualification, course, institution, year_obtained) values
  ('c0000000-0000-0000-0000-000000000002', 'education', 'B.Sc.', 'Psychology', 'University of Lagos', 2016),
  ('c0000000-0000-0000-0000-000000000002', 'professional', 'Associate Member', null, 'Chartered Institute of Personnel Management', 2020);

insert into public.employee_dependents (employee_id, full_name, relationship, date_of_birth) values
  ('c0000000-0000-0000-0000-000000000004', 'Amaka Manager', 'spouse', '1988-04-12'),
  ('c0000000-0000-0000-0000-000000000004', 'Tolu Manager', 'child', '2015-08-30');

-- Link the records that have a test login. Their staff accounts take their names from HR from now on.
select public.link_employee_login(id) from public.employees
where staff_id is null and work_email in (select email from auth.users);

-- The Abuja supervisor was promoted to run the branch, which leaves a promotion on his job history.
select public.change_employee_job('c0000000-0000-0000-0000-000000000006', 'promotion', '20000000-0000-0000-0000-000000000002',
  'administration', (select id from public.job_titles where name = 'Branch Manager'), current_date - 30,
  'Took over the Abuja office after the previous manager retired');

-- Salaries, proposed by the payroll officer and approved by the Head of HR, from January.
select pg_temp.act_as('payroll@kuun.test');
insert into public.employee_salaries (employee_id, effective_from, basic, housing, transport, medical, utility, other_allowance, reason)
select e.id, date_trunc('year', current_date)::date, s.basic, s.housing, s.transport, s.medical, s.utility, 0, 'Salary on the ERP from January'
from (values
  ('c0000000-0000-0000-0000-000000000001'::uuid, 600000, 300000, 120000, 40000, 40000),
  ('c0000000-0000-0000-0000-000000000002', 250000, 125000, 60000, 20000, 20000),
  ('c0000000-0000-0000-0000-000000000003', 180000, 90000, 45000, 15000, 15000),
  ('c0000000-0000-0000-0000-000000000004', 400000, 200000, 90000, 30000, 30000),
  ('c0000000-0000-0000-0000-000000000005', 200000, 100000, 50000, 15000, 15000),
  ('c0000000-0000-0000-0000-000000000006', 350000, 175000, 80000, 25000, 25000)
) as s(id, basic, housing, transport, medical, utility)
join public.employees e on e.id = s.id;
-- The new starter's salary is still waiting for approval, so it shows on the payroll page.
insert into public.employee_salaries (employee_id, effective_from, basic, housing, transport, reason)
values ('c0000000-0000-0000-0000-000000000007', date_trunc('month', current_date)::date, 150000, 75000, 40000, 'Starting salary');
insert into public.employee_deductions (employee_id, kind, description, monthly_amount, total_amount, start_month)
values ('c0000000-0000-0000-0000-000000000003', 'salary_advance', 'School fees advance', 20000, 60000,
        (date_trunc('month', current_date) - interval '1 month')::date);
update public.employees set annual_rent = 1500000 where id = 'c0000000-0000-0000-0000-000000000003';

select pg_temp.act_as('head.hr@kuun.test');
select public.decide_salary(id, true) from public.employee_salaries
where status = 'pending'
  and employee_id not in ('c0000000-0000-0000-0000-000000000007', 'c0000000-0000-0000-0000-000000000001');
-- Nobody approves their own salary, so the Financial Controller approves the Head of HR's.
select pg_temp.act_as('controller@kuun.test');
select public.decide_salary(id, true) from public.employee_salaries
where employee_id = 'c0000000-0000-0000-0000-000000000001';

-- Last month's payroll, prepared by payroll and approved by the Financial Controller, which posts it to the ledger.
select pg_temp.act_as('payroll@kuun.test');
select public.create_payroll_run(p, 'Monthly payroll') from (select (date_trunc('month', current_date) - interval '1 month')::date p) x
where p >= '2026-01-01';
select public.submit_payroll_run(id) from public.payroll_runs where status = 'draft';
select pg_temp.act_as('controller@kuun.test');
select public.approve_payroll_run(id) from public.payroll_runs where status = 'submitted';

-- Leave: casual leave taken in February, and annual leave in December waiting for the relief officer.
select pg_temp.act_as('hr.lagos@kuun.test');
select public.request_leave((select id from public.leave_types where name = 'Casual leave'),
  make_date(extract(year from current_date)::integer, 2, 10), make_date(extract(year from current_date)::integer, 2, 11),
  'Family wedding', null, null, 'c0000000-0000-0000-0000-000000000005');
select pg_temp.act_as('manager.lagos@kuun.test');
select public.approve_leave_step(id, 'Enjoy it') from public.leave_requests where employee_id = 'c0000000-0000-0000-0000-000000000005';
select pg_temp.act_as('head.hr@kuun.test');
select public.approve_leave_step(id) from public.leave_requests where employee_id = 'c0000000-0000-0000-0000-000000000005';
select pg_temp.act_as('hr.lagos@kuun.test');
select public.request_leave((select id from public.leave_types where name = 'Annual leave'),
  make_date(extract(year from current_date)::integer, 12, 7), make_date(extract(year from current_date)::integer, 12, 11),
  'End-of-year break', 'c0000000-0000-0000-0000-000000000003', null, 'c0000000-0000-0000-0000-000000000005');

-- A review the Branch Manager has submitted for the Lagos account officer to acknowledge, and two goals.
select pg_temp.act_as('manager.lagos@kuun.test');
insert into public.performance_reviews (id, employee_id, period_label, period_start, period_end, strengths, improvements, reviewer_comments)
values ('d0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000005', 'First half of the year',
        date_trunc('year', current_date)::date, (date_trunc('year', current_date) + interval '6 months - 1 day')::date,
        'Builds strong relationships with salary-earner customers.', 'Follow up overdue repayments sooner.',
        'A solid half-year. Keep the portfolio clean.');
insert into public.performance_review_scores (review_id, criterion, target, actual, score, sort_order) values
  ('d0000000-0000-0000-0000-000000000001', 'Loans booked', '20 loans', '23 loans', 5, 1),
  ('d0000000-0000-0000-0000-000000000001', 'Portfolio at risk', 'Under 5%', '7%', 3, 2),
  ('d0000000-0000-0000-0000-000000000001', 'Teamwork', null, null, 4, 3);
select public.submit_performance_review('d0000000-0000-0000-0000-000000000001');
insert into public.employee_goals (employee_id, title, goal_type, target_date, description) values
  ('c0000000-0000-0000-0000-000000000005', 'Bring portfolio at risk under 5%', 'performance', current_date + 60,
   'Call every customer more than seven days overdue within two working days.'),
  ('c0000000-0000-0000-0000-000000000005', 'Complete the credit risk course', 'development', current_date + 45, null);

-- Training: a course coming up for Credit, and a completed customer service course.
select pg_temp.act_as('hr.lagos@kuun.test');
insert into public.trainings (id, title, description, trainer, starts_on, ends_on, hours, venue, capacity, pass_mark, departments) values
  ('e0000000-0000-0000-0000-000000000001', 'Credit risk basics', 'Bureau checks, affordability and early warning signs.',
   'Ade and Partners', current_date + 21, current_date + 22, 12, 'Lagos office training room', 15, 70, '{credit}'),
  ('e0000000-0000-0000-0000-000000000002', 'Customer service excellence', 'Handling member enquiries and complaints.',
   'In-house', current_date + 1, current_date + 1, 6, 'Lagos office', null, null, '{}');
select public.enrol_in_training('e0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000003');
update public.trainings set starts_on = current_date - 40, ends_on = current_date - 40, status = 'completed'
where id = 'e0000000-0000-0000-0000-000000000002';
select public.record_training_result(id, 'completed', 6, null) from public.training_enrollments
where training_id = 'e0000000-0000-0000-0000-000000000002';

-- Commission: last quarter's target for the Lagos account officer, with one sale approved and one waiting.
insert into public.commission_targets (id, employee_id, name, period_start, period_end, target_amount, method, rate) values
  ('f0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000005', 'Loan book growth',
   (date_trunc('month', current_date) - interval '3 months')::date, (date_trunc('month', current_date) - interval '1 day')::date,
   3000000, 'percent_of_sales', 1);
select pg_temp.act_as('credit.lagos@kuun.test');
insert into public.commission_sales (target_id, employee_id, client_name, description, amount, sale_date, reference) values
  ('f0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000005', 'Okeke Building Supplies', 'Business loan',
   1000000, (date_trunc('month', current_date) - interval '2 months')::date, 'LN-B-001'),
  ('f0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000005', 'Ada Obi', 'Personal loan',
   300000, (date_trunc('month', current_date) - interval '1 month')::date, 'LN-P-002');
select pg_temp.act_as('controller@kuun.test');
select public.decide_commission_sale(id, true) from public.commission_sales where reference = 'LN-B-001';

-- An anonymous concern for Internal Audit to follow up.
select pg_temp.act_as('officer.lagos@kuun.test');
select public.submit_whistleblowing_report('misconduct', 'Pressure to backdate member files',
  'A colleague has asked twice for KYC files to be dated earlier than they were received, before month-end reporting.',
  null, 'Lagos office', null, true);

select set_config('request.jwt.claim.sub', '', false);

-- Age a few demo records so the Internal Audit exception checks have something to show on a fresh database.
-- Triggers are off for these updates only, so the audit trail keeps the original history.
set session_replication_role = replica;
update public.members set created_at = now() - interval '10 days', submitted_at = now() - interval '9 days' where id = '50000000-0000-0000-0000-000000000003';
update public.finance_transactions set created_at = now() - interval '4 days', submitted_at = now() - interval '4 days' where id = '90000000-0000-0000-0000-000000000003';
update public.bank_statement_lines set line_date = current_date - 18
where bank_account_id = '40000000-0000-0000-0000-000000000001' and reference = 'DEP-55120';
-- Loans were raised before they were paid out; the stale application has waited more than a week.
update public.loans
   set created_at = disbursed_on - interval '6 days', submitted_at = disbursed_on - interval '5 days',
       appraised_at = disbursed_on - interval '3 days', approved_at = disbursed_on - interval '2 days', decided_at = disbursed_on - interval '2 days'
 where disbursed_on is not null;
update public.loans set created_at = now() - interval '10 days', submitted_at = now() - interval '9 days'
 where id = 'b0000000-0000-0000-0000-000000000006';
set session_replication_role = origin;
