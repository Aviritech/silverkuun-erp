-- Silverkuun ERP: dummy data to test the whole system end to end.
-- Run after 01-schema.sql and 02-seed-organisation.sql, on a NEW project. Run it once, as one script.
--
-- Every record is created the way the app creates it: as the staff member who would do that step (their login is
-- "borrowed" for each step), through the same workflow functions, so every rule, approval and audit entry applies.
-- Uploaded documents are placeholders: the rows exist but no file is stored behind them, so "download" links on
-- seeded documents won't open a file. Anything you upload while testing works normally.
--
-- What you get (16 members across all 10 branches, 3 regions):
--   Operations   members at every stage (draft, with marketer, waiting for Branch Manager, sent back, approved);
--                Silver, Gold, Platinum, Target (3/6/12 months) and Child savings plans; contributions; targets;
--                interest due today; plans maturing soon and matured.
--   Accounts     top ups (logged, waiting, sent back); member receipts waiting for / confirmed / returned by
--                Operations; payments at every stage (waiting approval, waiting Internal Audit, paid, sent back by
--                the payments desk); opening balances; a bank statement to reconcile; supplier bill; posting rule.
--   Liquidations waiting for the Branch Manager, sent back, approved for Accounts, payout raised, and paid.
--   Credit       loans in draft, submitted, appraised, approved by Credit, approved for payout, active (on time,
--                late with a daily penalty, 30+ days behind with a restructure waiting for the Head of Business) and
--                repaid (with a late penalty paid).
--   HR           employees, salaries, last month's payroll, leave, a performance review, training, commission.
--   Audit        an anonymous whistleblowing report and records aged to trip the exception checks.

-- ---------------------------------------------------------------------------
-- Helpers (temporary: they disappear when the script ends)
-- ---------------------------------------------------------------------------

create function pg_temp.act_as(p_email text) returns void language plpgsql as $$
declare v_id uuid;
begin
  select id into v_id from public.staff where email = p_email;
  if v_id is null then raise exception 'no staff login %', p_email; end if;
  perform set_config('request.jwt.claim.sub', v_id::text, false);
end $$;

-- The login that does p_role's work for a branch: someone given that role for the branch, its region or the
-- whole organisation.
create function pg_temp.staff_for(p_role text, p_branch uuid) returns text language sql stable as $$
  select s.email
  from public.staff_roles sr join public.staff s on s.id = sr.staff_id
  where sr.role_code = p_role
    and (sr.branch_id = p_branch
         or sr.region_id = (select region_id from public.branches where id = p_branch)
         or (sr.branch_id is null and sr.region_id is null))
  -- The original logins (lowest ids) do the work, so the demo data reads the same with or without the per-branch logins.
  order by s.id
  limit 1;
$$;

create function pg_temp.as_role(p_role text, p_branch uuid) returns void language sql as $$
  select pg_temp.act_as(pg_temp.staff_for(p_role, p_branch));
$$;

create function pg_temp.b(p_n int) returns uuid language sql immutable as $$
  select ('20000000-0000-0000-0000-0000000000' || lpad(p_n::text, 2, '0'))::uuid;
$$;
create function pg_temp.bank(p_branch uuid) returns uuid language sql immutable as $$
  select ('40000000-0000-0000-0000-0000000000' || right(p_branch::text, 2))::uuid;
$$;
create function pg_temp.cash(p_branch uuid) returns uuid language sql immutable as $$
  select ('41000000-0000-0000-0000-0000000000' || right(p_branch::text, 2))::uuid;
$$;

create function pg_temp.add_docs(p_member uuid, p_types text[]) returns void language sql as $$
  insert into public.member_documents (member_id, branch_id, document_type, file_name, storage_path, mime_type, size_bytes)
  select m.id, m.branch_id, t::public.member_document_type, t || '.pdf', m.branch_id || '/' || m.id || '/seed-' || t || '.pdf',
         'application/pdf', 1024
  from public.members m, unnest(p_types) t where m.id = p_member;
$$;

create function pg_temp.attach(p_txn uuid, p_kind text, p_name text) returns void language sql as $$
  insert into public.finance_attachments (transaction_id, branch_id, kind, file_name, storage_path, mime_type, size_bytes)
  select t.id, t.branch_id, p_kind, p_name, t.branch_id || '/' || t.id || '/seed-' || p_name, 'application/pdf', 1024
  from public.finance_transactions t where t.id = p_txn;
$$;

-- A placeholder drawn signature, standing in for what the Branch Manager signs on screen.
create temporary table seed_signature as select 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAPAAAABGCAYAAADyxhn6AAACr0lEQVR42u3dSW7kMAxAUR8jQN//nOoLNNCxLNoc3uLvgnJc0pdIaqjr5+fPBaAmvgSAwAAIDIDAAIEBEBgAgQEQGCAwAAIDIDBAYAAEBkBgAAQGCAyAwAAIDIDAAIHLs/6BTgECF5WXxCBwcXlX83fU6QncXuAlugCBa+W9UwQmMYFbde5uBa01IMJQgBwq8P8avKPA17AIg8BNCzVrgMBrgMDSgyYC323I3zZ05Q4xMcIYL/GEPG8RuHWEsfteLeTvLPDOCF21QScPUDsitpnBu1eSTzQugfNXnZ8M0gROHCbuNE61BhVh7P9NeYm7CXxiG2GGxozM23c/N9P3cbJvXATOOdtUeM7T/CwqRcg0Qz0ZcHaX2RaBa0v1VWPeDe8iooxVVOA7M2ybKj2B6wm8DswaTwuB6+C7nW6H3f/95HLUa/3mVGd7u3N3GzDuzh5PO8uOqFECryQCRzwvvE9XEWoNFDg6rN35zIhZKtOseHI9+e7zCJyo4r0SP+vJZ0bNiCfz+6eFqadFs+jBKUTgKTlpVKX2q7XcL2ap3z47Y5uf3Bk2VuCM+287rD2/WRXOvC574nTba1Vva7KxlWE7v87sjqp4MCQyPTi2jETg541j73W+bY1PZ9cTOfLrAq9m4fOp3VEV3u+rrY2ZTwedyM3Do4tM+VD22Smi0NP1dFDX88enjy6WEdj53FkXCEy5JPDznVoZjvi5IcMdXN0v0Asb0DLsIJrSwSfcUdVp9s14rDLsMMOdtVK3RLpkDskF3llumXDRercQ8yLwHIFH3JAQVMmckCfi4/PAJ4pU0zp4519DJFjBA/3p1skIXDYqeQMCC8PKVTIXCCwMIw+BCUwgAoHABCYQgQlMHhC4jsA6AAgMgMAACAwQGACBARAYAIEBAgMgMAACA+P5C0FOeCPvj+R4AAAAAElFTkSuQmCC'::text as png;

-- Takes a draft member file through the approval chain up to p_stage:
-- 'with_marketer', 'pending_approval' (waiting for the Branch Manager), 'returned' (sent back by the Branch Manager)
-- or 'approved'. Officer -> marketer -> officer -> Branch Manager.
create function pg_temp.onboard(p_member uuid, p_stage text) returns void language plpgsql as $$
declare v_branch uuid;
begin
  select branch_id into v_branch from public.members where id = p_member;
  perform pg_temp.as_role('admin_officer', v_branch);
  perform public.send_member_to_marketer(p_member);
  if p_stage = 'with_marketer' then return; end if;
  perform pg_temp.as_role('marketer', v_branch);
  perform public.marketer_review_member(p_member, 'My customer; details confirmed by phone');
  perform pg_temp.as_role('admin_officer', v_branch);
  perform public.submit_member(p_member);
  if p_stage = 'pending_approval' then return; end if;
  perform pg_temp.as_role('branch_manager', v_branch);
  if p_stage = 'returned' then
    perform public.return_member(p_member, 'The utility bill is older than three months. Please get a recent one.');
  else
    perform public.approve_member(p_member, (select png from seed_signature));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Members: 16 across all 10 branches. IDs 50000000-...-0000000000NN.
-- Interest is paid on interest_pay_day each month; Amina, Ada and Chinedu are due today.
-- ---------------------------------------------------------------------------

create temporary table seed_members (n int, branch int, title text, first_name text, last_name text, gender text, phone text,
  email text, address text, id_type text, bank_code text, bank_name text, account_no text, pay_day int, stage text);
insert into seed_members values
  (1,  1, 'Mrs', 'Amina',    'Yusuf',      'female', '08031000001', 'amina.yusuf@example.com', '14 Mabushi District, Abuja',          'national_id',            '058', null,             '0100000001', extract(day from current_date), 'approved'),
  (2,  1, 'Mr',  'Emeka',    'Eze',        'male',   '08031000002', null,                      '7 Ahmadu Bello Way, Mabushi, Abuja',  'drivers_licence',        '057', null,             '0100000002', 10,  'approved'),
  (3,  2, 'Ms',  'Grace',    'Okafor',     'female', '08031000003', 'grace.okafor@example.com','3 Katampe Road, Mabushi, Abuja',      'international_passport', '044', null,             '0100000003', 20,  'approved'),
  (4,  3, 'Mr',  'Ibrahim',  'Musa',       'male',   '08031000004', null,                      '22 Obafemi Awolowo Way, Utako, Abuja','voters_card',            '011', null,             '0100000004', 5,   'approved'),
  (5,  4, 'Mrs', 'Blessing', 'Nwachukwu',  'female', '08031000005', null,                      '9 Gado Nasko Road, Kubwa, Abuja',     'national_id',            '033', null,             '0100000005', null,'pending_approval'),
  (6,  5, 'Mrs', 'Ada',      'Obi',        'female', '08031000006', 'ada.obi@example.com',     '12 Allen Avenue, Ikeja, Lagos',       'national_id',            '058', null,             '0100000006', extract(day from current_date), 'approved'),
  (7,  5, 'Mr',  'Chinedu',  'Okeke',      'male',   '08031000007', null,                      '4 Opebi Road, Ikeja, Lagos',          'drivers_licence',        '057', null,             '0100000007', extract(day from current_date), 'approved'),
  (8,  5, 'Ms',  'Funke',    'Adeyemi',    'female', '08031000008', null,                      '9 Toyin Street, Ikeja, Lagos',        'international_passport', null,  'Moniepoint MFB', '0100000008', 15,  'pending_approval'),
  (9,  5, 'Mr',  'Tunde',    'Balogun',    'male',   '08031000009', null,                      '3 Obafemi Awolowo Way, Ikeja, Lagos', 'voters_card',            null,  null,             null,         null,'with_marketer'),
  (10, 6, 'Mrs', 'Zainab',   'Bello',      'female', '08031000010', 'zainab.bello@example.com','5 Bourdillon Road, Ikoyi, Lagos',     'national_id',            '044', null,             '0100000010', 25,  'approved'),
  (11, 7, 'Mr',  'Segun',    'Ajayi',      'male',   '08031000011', null,                      '22 Herbert Macaulay Way, Yaba, Lagos','national_id',            '011', null,             '0100000011', 1,   'approved'),
  (12, 8, 'Mrs', 'Ngozi',    'Umeh',       'female', '08031000012', null,                      '4th Avenue, Festac Town, Lagos',      'drivers_licence',        '033', null,             '0100000012', null,'returned'),
  (13, 9, 'Mr',  'Ebi',      'Douglas',    'male',   '08031000013', 'ebi.douglas@example.com', '45 Aba Road, Port Harcourt',          'national_id',            '214', null,             '0100000013', 28,  'approved'),
  (14, 9, 'Mr',  'Tamuno',   'Briggs',     'male',   '08031000014', null,                      '12 Rumuola Road, Port Harcourt',      'international_passport', '058', null,             '0100000014', 12,  'approved'),
  (15, 10,'Mrs', 'Ifeoma',   'Nnamdi',     'female', '08031000015', null,                      '8 Peter Odili Road, Port Harcourt',   'national_id',            '057', null,             '0100000015', 18,  'approved'),
  (16, 10,'Ms',  'Boma',     'George',     'female', '08031000016', null,                      '2 Trans-Amadi Road, Port Harcourt',   'voters_card',            null,  null,             null,         null,'draft');

create function pg_temp.m(p_n int) returns uuid language sql immutable as $$
  select ('50000000-0000-0000-0000-0000000000' || lpad(p_n::text, 2, '0'))::uuid;
$$;

do $$
declare r record;
begin
  for r in select * from seed_members order by n loop
    perform pg_temp.as_role('admin_officer', pg_temp.b(r.branch));
    insert into public.members (id, branch_id, title, first_name, last_name, gender, phone, email, address, nin, id_type, id_number,
      date_of_birth, next_of_kin_name, next_of_kin_phone, next_of_kin_relationship, bank_code, bank_name, bank_account_no, interest_pay_day)
    values (pg_temp.m(r.n), pg_temp.b(r.branch), r.title, r.first_name, r.last_name, r.gender, r.phone, r.email, r.address,
      '2233344' || lpad(r.n::text, 4, '0'), r.id_type, 'ID-' || lpad(r.n::text, 5, '0'),
      date '1975-01-01' + (r.n * 517), 'Next of kin of ' || r.first_name, '0809000' || lpad(r.n::text, 4, '0'), 'Spouse',
      r.bank_code, r.bank_name, r.account_no, r.pay_day);
    if r.stage = 'with_marketer' then
      perform pg_temp.add_docs(pg_temp.m(r.n), array['kyc_form', 'nin_slip']);
    elsif r.stage <> 'draft' then
      perform pg_temp.add_docs(pg_temp.m(r.n), array['kyc_form', 'nin_slip', 'means_of_id', 'utility_bill', 'passport_photo']);
    end if;
    if r.stage <> 'draft' then
      perform pg_temp.onboard(pg_temp.m(r.n), r.stage);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Savings plans (IDs 60000000-...-0000000000NN) and contributions, verified by each Branch Manager.
-- Target savings run exactly 3, 6 or 12 months; Child savings run 3 months and start at 200,000.
-- ---------------------------------------------------------------------------

create temporary table seed_plans (n int, member int, plan_type text, amount numeric, frequency text, start_date date, maturity_date date,
  paid int, note text);
insert into seed_plans values
  -- Abuja
  (1,  1, 'gold',     50000,  'monthly', current_date - 60,  current_date + 305, 2, 'Active, interest due today'),
  (2,  1, 'target',   30000,  'monthly', current_date - 95,  (current_date - 95 + interval '6 months')::date, 3, 'Target, 6 months, dividends at maturity'),
  (3,  2, 'silver',   20000,  'monthly', current_date - 45,  current_date + 320, 1, 'Active'),
  (4,  2, 'child',    250000, 'one_off', current_date - 20,  (current_date - 20 + interval '3 months')::date, 1, 'Child savings'),
  (5,  3, 'platinum', 500000, 'one_off', current_date - 350, current_date + 15,  1, 'Matures in 15 days'),
  (6,  4, 'target',   150000, 'one_off', (current_date - interval '4 months')::date, (current_date - interval '1 month')::date, 1, 'Target, 3 months, matured, liquidated and paid'),
  (7,  4, 'silver',   15000,  'monthly', current_date - 20,  current_date + 345, 1, 'Active'),
  -- Lagos
  (8,  6, 'gold',     50000,  'monthly', current_date - 60,  current_date + 305, 1, 'Active, interest due today'),
  (9,  7, 'silver',   20000,  'monthly', current_date - 30,  current_date + 335, 2, 'Active, interest due today'),
  (10, 7, 'platinum', 250000, 'one_off', current_date - 350, current_date + 15,  1, 'Matures in 15 days'),
  (11, 10,'child',    300000, 'one_off', (current_date - interval '3 months' - interval '5 days')::date, (current_date - interval '5 days')::date, 1, 'Child savings, matured, liquidation waiting for the Branch Manager'),
  (12, 11,'silver',   90000,  'one_off', current_date - 400, current_date - 35,  1, 'Matured, liquidation approved, waiting for Accounts'),
  (13, 10,'target',   40000,  'monthly', current_date - 40,  (current_date - 40 + interval '12 months')::date, 1, 'Target, 12 months'),
  -- Port Harcourt
  (14, 13,'gold',     120000, 'one_off', current_date - 400, current_date - 35,  1, 'Matured, liquidation sent back by the Branch Manager'),
  (15, 14,'target',   25000,  'monthly', current_date - 120, (current_date - 120 + interval '12 months')::date, 4, 'Target, 12 months'),
  (16, 15,'platinum', 400000, 'one_off', current_date - 400, current_date - 35,  1, 'Matured, payout raised, waiting for the Financial Controller'),
  (17, 15,'silver',   15000,  'monthly', current_date - 30,  current_date + 335, 1, 'Active'),
  (18, 13,'silver',   10000,  'monthly', current_date - 15,  current_date + 350, 0, 'Active, first payment waiting as a receipt');

create function pg_temp.p(p_n int) returns uuid language sql immutable as $$
  select ('60000000-0000-0000-0000-0000000000' || lpad(p_n::text, 2, '0'))::uuid;
$$;

do $$
declare r record; v_branch uuid; i int;
begin
  for r in select p.*, m.branch_id from seed_plans p join public.members m on m.id = pg_temp.m(p.member) order by p.n loop
    perform pg_temp.as_role('admin_officer', r.branch_id);
    insert into public.member_plans (id, member_id, branch_id, plan_type, contribution_amount, contribution_frequency, start_date, maturity_date)
    values (pg_temp.p(r.n), pg_temp.m(r.member), r.branch_id, r.plan_type, r.amount, r.frequency, r.start_date, r.maturity_date);
    for i in 1 .. r.paid loop
      insert into public.contributions (member_plan_id, member_id, branch_id, kind, amount, paid_on, payment_method, reference)
      values (pg_temp.p(r.n), pg_temp.m(r.member), r.branch_id, 'scheduled', r.amount,
              least(r.start_date + (i - 1) * 30 + 1, current_date - 1), case when i % 2 = 0 then 'cash' else 'bank_transfer' end,
              'SEED-P' || lpad(r.n::text, 2, '0') || '-' || i);
    end loop;
  end loop;
  -- Branch Managers verify everything except Chinedu's latest payment, which stays waiting in the Ikeja queue.
  for v_branch in select distinct branch_id from public.contributions loop
    perform pg_temp.as_role('branch_manager', v_branch);
    perform public.verify_contribution(c.id) from public.contributions c
    where c.branch_id = v_branch and c.reference <> 'SEED-P09-2';
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Top ups start in Accounts (who picks the branch); the branch officer logs them against a plan or sends them back.
-- ---------------------------------------------------------------------------

select pg_temp.as_role('regional_accountant', pg_temp.b(5));
select public.initiate_top_up(null, pg_temp.b(5), 25000, current_date - 5, 'bank_transfer', 'TRF-ADA-002', pg_temp.bank(pg_temp.b(5)), 'Ada Obi', null);
select public.initiate_top_up(null, pg_temp.b(5), 40000, current_date - 1, 'bank_transfer', 'TRF-CHI-009', pg_temp.bank(pg_temp.b(5)), 'Chinedu Okeke',
  'Member says it is for his Silver plan');
select public.initiate_top_up(null, pg_temp.b(7), 18000, current_date - 3, 'bank_transfer', 'TRF-UNK-771', pg_temp.bank(pg_temp.b(7)), 'S. Ajay',
  'Name on the transfer does not match exactly');
select pg_temp.as_role('regional_accountant', pg_temp.b(1));
select public.initiate_top_up(null, pg_temp.b(1), 60000, current_date - 2, 'pos', 'POS-AMI-114', pg_temp.bank(pg_temp.b(1)), 'Amina Yusuf', null);
select pg_temp.as_role('regional_accountant', pg_temp.b(9));
select public.initiate_top_up(null, pg_temp.b(9), 35000, current_date - 4, 'bank_transfer', 'TRF-TAM-030', pg_temp.bank(pg_temp.b(9)), 'Tamuno Briggs', null);

select pg_temp.as_role('admin_officer', pg_temp.b(5));
select public.log_top_up(id, pg_temp.p(8), 'Ada confirmed by phone') from public.top_up_requests where reference = 'TRF-ADA-002';
select pg_temp.as_role('admin_officer', pg_temp.b(9));
select public.log_top_up(id, pg_temp.p(15), 'Top up for his target savings') from public.top_up_requests where reference = 'TRF-TAM-030';
select pg_temp.as_role('admin_officer', pg_temp.b(7));
select public.return_top_up(id, 'We have no member called S. Ajay. Please check the sender with the bank.')
from public.top_up_requests where reference = 'TRF-UNK-771';

-- Logged top ups are contributions; the Branch Manager verifies them.
select pg_temp.as_role('branch_manager', pg_temp.b(5));
select public.verify_contribution(contribution_id) from public.top_up_requests where reference = 'TRF-ADA-002';

-- ---------------------------------------------------------------------------
-- Opening balances for every region, prepared by the regional accountant and posted by the Financial Controller.
-- ---------------------------------------------------------------------------

do $$
declare v_n int; v_entry uuid;
begin
  foreach v_n in array array[1, 5, 9] loop
    perform pg_temp.as_role('regional_accountant', pg_temp.b(v_n));
    v_entry := ('80000000-0000-0000-0000-0000000000' || lpad(v_n::text, 2, '0'))::uuid;
    insert into public.journal_entries (id, branch_id, entry_date, description)
    values (v_entry, pg_temp.b(v_n), current_date - 30, 'Opening balances at cutover - ' || (select name from public.branches where id = pg_temp.b(v_n)));
    insert into public.journal_lines (entry_id, line_no, branch_id, account_code, debit, credit) values
      (v_entry, 1, pg_temp.b(v_n), (select ledger_account_code from public.bank_accounts where id = pg_temp.bank(pg_temp.b(v_n))), 5000000, 0),
      (v_entry, 2, pg_temp.b(v_n), '1110', 150000, 0),
      (v_entry, 3, pg_temp.b(v_n), '3200', 0, 5150000);
    perform pg_temp.act_as('controller@kuun.test');
    perform public.post_journal_entry(v_entry);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Receipts and payments. IDs 90000000-...
-- ---------------------------------------------------------------------------

-- Ada's first verified contribution becomes a receipt in Accounts, approved by the Financial Controller.
select pg_temp.as_role('regional_accountant', pg_temp.b(5));
insert into public.finance_transactions (id, direction, transaction_type, txn_date, amount, bank_account_id, member_id, reference, description, contribution_id, branch_id)
select '90000000-0000-0000-0000-000000000001', 'receipt', 'member_savings', c.paid_on, c.amount, pg_temp.bank(pg_temp.b(5)),
       pg_temp.m(6), c.reference, 'Gold plan contribution', c.id, pg_temp.b(5)
from public.contributions c where c.reference = 'SEED-P08-1';
select public.submit_finance_transaction('90000000-0000-0000-0000-000000000001');
select pg_temp.act_as('controller@kuun.test');
select public.approve_finance_transaction('90000000-0000-0000-0000-000000000001');

-- Member receipts recorded by Accounts against a plan go to Operations to check before Accounts posts them:
-- Chinedu (Ikeja) is waiting, Emeka (Mabushi Main) has been confirmed, Ebi (Aba Road) was sent back.
create function pg_temp.member_receipt(p_id uuid, p_member int, p_plan int, p_amount numeric, p_cash boolean, p_ref text, p_desc text)
returns void language plpgsql as $$
declare v_branch uuid := (select branch_id from public.members where id = pg_temp.m(p_member));
begin
  -- Abuja and Lagos have a receipts accountant; Port Harcourt's regional accountant records receipts.
  perform pg_temp.act_as(coalesce(pg_temp.staff_for('receipts_accountant', v_branch), pg_temp.staff_for('regional_accountant', v_branch)));
  insert into public.finance_transactions (id, direction, transaction_type, txn_date, amount, bank_account_id, member_id, member_plan_id,
    counterparty, reference, description, branch_id)
  select p_id, 'receipt', 'member_savings', current_date, p_amount,
         case when p_cash then pg_temp.cash(v_branch) else pg_temp.bank(v_branch) end,
         m.id, pg_temp.p(p_plan), m.first_name || ' ' || m.last_name, p_ref, p_desc, v_branch
  from public.members m where m.id = pg_temp.m(p_member);
  perform pg_temp.attach(p_id, 'supporting', 'receipt.pdf');
  perform public.submit_finance_transaction(p_id);
end $$;

select pg_temp.member_receipt('90000000-0000-0000-0000-000000000005', 7, 9, 15000, true, 'CASH-IKJ-0412', 'Cash top up to Silver plan');
select pg_temp.member_receipt('90000000-0000-0000-0000-000000000006', 2, 3, 20000, false, 'TRF-EME-221', 'Silver plan monthly saving');
select pg_temp.member_receipt('90000000-0000-0000-0000-000000000007', 13, 18, 10000, false, 'TRF-EBI-001', 'First Silver plan saving');

select pg_temp.as_role('admin_officer', pg_temp.b(1));
select public.confirm_member_receipt('90000000-0000-0000-0000-000000000006', 'Matches his passbook');
select pg_temp.act_as('controller@kuun.test');
select public.approve_finance_transaction('90000000-0000-0000-0000-000000000006');
select pg_temp.as_role('admin_officer', pg_temp.b(9));
select public.return_member_receipt('90000000-0000-0000-0000-000000000007', 'Ebi says he paid 15,000, not 10,000. Please check the bank alert.');

-- A payment through the full chain: requested, approved by the Financial Controller and Internal Audit, paid with proof.
create function pg_temp.payment(p_id uuid, p_branch uuid, p_type text, p_days_ago int, p_amount numeric, p_payee text, p_ref text, p_desc text,
  p_stage text) returns void language plpgsql as $$
begin
  -- p_stage: 'submitted', 'approved' (waiting for Internal Audit), 'audited' (waiting to be paid), 'paid', 'sent_back'.
  perform pg_temp.as_role('regional_accountant', p_branch);
  insert into public.finance_transactions (id, direction, transaction_type, txn_date, amount, bank_account_id, counterparty, reference, description, branch_id)
  values (p_id, 'payment', p_type, current_date - p_days_ago, p_amount, pg_temp.bank(p_branch), p_payee, p_ref, p_desc, p_branch);
  perform pg_temp.attach(p_id, 'supporting', 'invoice.pdf');
  perform public.submit_finance_transaction(p_id);
  if p_stage = 'submitted' then return; end if;
  perform pg_temp.act_as('controller@kuun.test');
  perform public.approve_finance_transaction(p_id);
  if p_stage = 'approved' then return; end if;
  perform pg_temp.act_as('auditor@kuun.test');
  perform public.audit_approve_payment(p_id);
  if p_stage = 'audited' then return; end if;
  -- The payments desk pays for every branch.
  perform pg_temp.act_as('payments@kuun.test');
  if p_stage = 'sent_back' then
    perform public.return_payment_before_paying(p_id, 'The invoice is made out to another company. Please get a corrected invoice.');
    return;
  end if;
  perform pg_temp.attach(p_id, 'payment_proof', 'transfer-receipt.pdf');
  perform public.pay_finance_transaction(p_id);
end $$;

select pg_temp.payment('90000000-0000-0000-0000-000000000002', pg_temp.b(5), 'admin_expense', 7, 350000, 'Allen Properties Ltd', 'INV-2026-114',
  'Ikeja office rent for the month', 'paid');
select pg_temp.payment('90000000-0000-0000-0000-000000000003', pg_temp.b(1), 'professional_fees', 2, 120000, 'Adewale & Co Chartered Accountants',
  'INV-AC-0091', 'Quarterly bookkeeping review', 'submitted');
select pg_temp.payment('90000000-0000-0000-0000-000000000004', pg_temp.b(5), 'admin_expense', 1, 48000, 'Shoprite Office Supplies', 'INV-SOS-2210',
  'Printer paper and toner for the Ikeja office', 'approved');
select pg_temp.payment('90000000-0000-0000-0000-000000000008', pg_temp.b(10), 'admin_expense', 3, 27500, 'Garden City Plumbers', 'INV-GCP-018',
  'Plumbing repairs at Peter Odili', 'sent_back');
select pg_temp.payment('90000000-0000-0000-0000-000000000009', pg_temp.b(3), 'admin_expense', 2, 65000, 'Utako Cleaning Services', 'INV-UCS-332',
  'Monthly office cleaning, Utako', 'audited');
select pg_temp.payment('90000000-0000-0000-0000-000000000010', pg_temp.b(7), 'admin_expense', 12, 210000, 'Yaba Tech Hub', 'INV-YTH-090',
  'Internet subscription for the Yaba office, one quarter', 'paid');

-- An Ikeja bank statement: three lines match the books, a bank charge and an unknown deposit wait for review.
select pg_temp.as_role('regional_accountant', pg_temp.b(5));
select public.import_bank_statement(
  pg_temp.bank(pg_temp.b(5)), 'access-ikeja-statement.csv', null, 'seed-statement-1',
  jsonb_build_array(
    jsonb_build_object('date', current_date - 30, 'description', 'OPENING BALANCE TRANSFER', 'reference', 'OPEN', 'amount', 5000000, 'balance', 5000000),
    jsonb_build_object('date', current_date - 59, 'description', 'TRF FROM ADA OBI', 'reference', 'SEED-P08-1', 'amount', 50000, 'balance', 5050000),
    jsonb_build_object('date', current_date - 6, 'description', 'TRF TO ALLEN PROPERTIES', 'reference', 'INV-2026-114', 'amount', -350000, 'balance', 4700000),
    jsonb_build_object('date', current_date - 6, 'description', 'SMS ALERT CHARGES', 'reference', null, 'amount', -1075, 'balance', 4698925),
    jsonb_build_object('date', current_date - 4, 'description', 'CASH DEPOSIT - UNKNOWN', 'reference', 'DEP-55120', 'amount', 75000, 'balance', 4773925)
  )
);
select public.auto_match_bank_lines(pg_temp.bank(pg_temp.b(5)));

-- Suppliers, and an Ikeja diesel bill approved by the Financial Controller and not yet paid.
insert into public.suppliers (id, name, contact_person, phone, bank_name, account_number) values
  ('a0000000-0000-0000-0000-000000000001', 'Allen Properties Ltd', 'Bola Ade', '08011112222', 'Access Bank', '0690000011'),
  ('a0000000-0000-0000-0000-000000000002', 'PowerGen Diesel Supplies', 'Emeka Nwosu', '08033334444', 'First Bank', '3012345678');
insert into public.supplier_bills (id, bill_no, supplier_id, branch_id, department_code, bill_date, due_date, supplier_reference,
  expense_account, amount, description) values
  ('a1000000-0000-0000-0000-000000000001', 'pending', 'a0000000-0000-0000-0000-000000000002', pg_temp.b(5),
   'administration', current_date - 20, current_date - 5, 'PG-4471', '5300', 85000, 'Diesel for the Ikeja office generator');
insert into public.finance_attachments (supplier_bill_id, branch_id, kind, file_name, storage_path, mime_type, size_bytes)
values ('a1000000-0000-0000-0000-000000000001', pg_temp.b(5), 'supporting', 'powergen-invoice.pdf',
        pg_temp.b(5) || '/bills/a1000000-0000-0000-0000-000000000001/seed-invoice.pdf', 'application/pdf', 1024);
select public.submit_supplier_bill('a1000000-0000-0000-0000-000000000001');

-- A posting rule change proposed by the accountant, waiting for the Financial Controller.
insert into public.posting_rule_changes (transaction_type, debit_account, requires_member, is_active, reason)
values ('bank_charges', '5800', false, true, 'Report bank charges under other operating expenses until they have their own budget line');

select pg_temp.act_as('controller@kuun.test');
select public.approve_supplier_bill('a1000000-0000-0000-0000-000000000001');

-- This month's targets for every branch, set by the Head of Operations.
select pg_temp.act_as('head.ops@kuun.test');
insert into public.branch_targets (branch_id, month, registrations, collections)
select b.id, date_trunc('month', current_date)::date, 5 + (row_number() over (order by b.code))::int % 4, 250000 + 50000 * ((row_number() over (order by b.code))::int % 5)
from public.branches b;

-- ---------------------------------------------------------------------------
-- Liquidations: Operations requests, the Branch Manager approves, Accounts pays.
-- ---------------------------------------------------------------------------

create function pg_temp.request_liq(p_plan int, p_amount numeric) returns uuid language plpgsql as $$
declare v_m public.members; v_id uuid;
begin
  select m.* into v_m from public.members m join public.member_plans p on p.member_id = m.id where p.id = pg_temp.p(p_plan);
  perform pg_temp.as_role('admin_officer', v_m.branch_id);
  select id into v_id from public.request_liquidation(null, pg_temp.p(p_plan), p_amount, v_m.first_name || ' ' || v_m.last_name,
    v_m.bank_code, v_m.bank_name, v_m.bank_account_no, 'Plan matured; the member asked to be paid out');
  return v_id;
end $$;

do $$
declare v_l uuid; v_txn uuid;
begin
  -- Zainab's Child savings (Ikoyi): waiting for the Branch Manager.
  perform pg_temp.request_liq(11, 300000);

  -- Ebi's Gold plan (Aba Road): the Branch Manager sent it back.
  v_l := pg_temp.request_liq(14, 120000);
  perform pg_temp.as_role('branch_manager', pg_temp.b(9));
  perform public.return_liquidation(v_l, 'The account number differs from the one on the member''s file. Please confirm with him.');

  -- Segun's Silver plan (Yaba): approved, waiting for Accounts to raise the payout.
  v_l := pg_temp.request_liq(12, 90000);
  perform pg_temp.as_role('branch_manager', pg_temp.b(7));
  perform public.decide_liquidation(v_l, true, 'Signed request letter seen');

  -- Ifeoma's Platinum plan (Peter Odili): approved, payout raised, waiting for the Financial Controller.
  v_l := pg_temp.request_liq(16, 400000);
  perform pg_temp.as_role('branch_manager', pg_temp.b(10));
  perform public.decide_liquidation(v_l, true, 'Signed request letter seen');
  perform pg_temp.as_role('regional_accountant', pg_temp.b(10));
  perform public.raise_liquidation_payment(v_l, pg_temp.bank(pg_temp.b(10)));

  -- Ibrahim's 3-month Target savings (Utako): paid in full, so the plan shows as liquidated.
  v_l := pg_temp.request_liq(6, 150000);
  perform pg_temp.as_role('branch_manager', pg_temp.b(3));
  perform public.decide_liquidation(v_l, true, 'Signed request letter seen');
  perform pg_temp.as_role('regional_accountant', pg_temp.b(3));
  select id into v_txn from public.raise_liquidation_payment(v_l, pg_temp.bank(pg_temp.b(3)));
  perform pg_temp.act_as('controller@kuun.test');
  perform public.approve_finance_transaction(v_txn);
  perform pg_temp.act_as('auditor@kuun.test');
  perform public.audit_approve_payment(v_txn);
  perform pg_temp.act_as('payments@kuun.test');
  perform pg_temp.attach(v_txn, 'payment_proof', 'transfer-receipt.pdf');
  perform public.pay_finance_transaction(v_txn);
end $$;

-- ---------------------------------------------------------------------------
-- Credit: loans at every stage, raised by the region's account officer, appraised by the analyst (who confirms the
-- guarantor), approved by the Head of Credit and then the Head of Business, and paid out and repaid through Accounts.
-- Interest rates and methods here are test values, not Kuun's confirmed products.
-- ---------------------------------------------------------------------------

create function pg_temp.new_loan(p_id uuid, p_member uuid, p_product text, p_amount numeric, p_tenor int, p_method text, p_rate numeric,
  p_category text, p_purpose text) returns void language plpgsql as $$
begin
  perform pg_temp.as_role('credit_officer', (select branch_id from public.members where id = p_member));
  insert into public.loans (id, branch_id, member_id, product_code, phone, address, address_landmark, customer_category, employer_name, occupation,
    monthly_income, amount_requested, purpose, tenor_months, repayment_frequency, interest_rate, rate_basis, interest_method, repayment_mode)
  select p_id, m.branch_id, m.id, p_product, m.phone, m.address,
         (array['Opposite First Bank', 'Behind the central market', 'Beside the filling station', 'Near the police post'])[1 + abs(hashtext(p_id::text)) % 4],
         p_category,
         case when p_category = 'salary_earner' then 'Federal Ministry of Education' else m.last_name || ' Enterprises' end,
         case when p_category = 'salary_earner' then 'Teacher' else 'Trader' end,
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
end $$;

create function pg_temp.loan_to(p_id uuid, p_stage text, p_amount numeric) returns void language plpgsql as $$
declare v_branch uuid := (select branch_id from public.loans where id = p_id);
begin
  -- p_stage: 'submitted', 'appraised', 'credit_approved', 'approved'
  perform pg_temp.as_role('credit_officer', v_branch);
  perform public.submit_loan(p_id);
  if p_stage = 'submitted' then return; end if;
  perform pg_temp.act_as('analyst@kuun.test');
  perform public.confirm_loan_guarantor(g.id, 'Called the guarantor, who confirmed they stand for the loan')
  from public.loan_guarantors g where g.loan_id = p_id;
  perform public.appraise_loan(p_id, 'clear', 'CRC Credit Bureau', '702', 'low', 'approve', p_amount,
    'Steady income, no adverse bureau records, repayment within a third of monthly income.');
  if p_stage = 'appraised' then return; end if;
  perform pg_temp.act_as('head.credit@kuun.test');
  perform public.decide_loan(p_id, true, p_amount, null);
  if p_stage = 'credit_approved' then return; end if;
  perform pg_temp.act_as('head.business@kuun.test');
  perform public.business_decide_loan(p_id, true, null);
end $$;

-- Accounts pays the loan out: the regional accountant requests it, the Financial Controller and Internal Audit
-- approve, and the accountant pays with proof.
create function pg_temp.disburse_loan(p_loan uuid, p_txn uuid, p_days_ago int) returns void language plpgsql as $$
declare v_branch uuid := (select branch_id from public.loans where id = p_loan);
begin
  perform pg_temp.as_role('regional_accountant', v_branch);
  insert into public.finance_transactions (id, direction, transaction_type, txn_date, amount, bank_account_id, member_id, loan_id,
    counterparty, reference, description, branch_id)
  select p_txn, 'payment', 'loan_disbursement', current_date - p_days_ago, l.approved_amount, pg_temp.bank(v_branch),
         l.member_id, l.id, 'Loan customer', 'DSB-' || l.loan_no, 'Disbursement of loan ' || l.loan_no, l.branch_id
  from public.loans l where l.id = p_loan;
  perform public.submit_finance_transaction(p_txn);
  perform pg_temp.act_as('controller@kuun.test');
  perform public.approve_finance_transaction(p_txn);
  perform pg_temp.act_as('auditor@kuun.test');
  perform public.audit_approve_payment(p_txn);
  perform pg_temp.as_role('regional_accountant', v_branch);
  perform pg_temp.attach(p_txn, 'payment_proof', 'transfer-receipt.pdf');
  perform public.pay_finance_transaction(p_txn);
end $$;

-- A repayment receipted by the accountant and confirmed by the controller. A null amount pays off everything owed.
create function pg_temp.repay_loan(p_loan uuid, p_txn uuid, p_amount numeric, p_days_ago int) returns void language plpgsql as $$
declare v_branch uuid := (select branch_id from public.loans where id = p_loan);
begin
  perform pg_temp.as_role('regional_accountant', v_branch);
  insert into public.finance_transactions (id, direction, transaction_type, txn_date, amount, bank_account_id, member_id, loan_id,
    reference, description, branch_id)
  select p_txn, 'receipt', 'loan_repayment', current_date - p_days_ago,
         coalesce(p_amount, (select b.outstanding_principal + b.outstanding_interest
                                    + greatest(0, app.loan_penalty_accrued(l.id, current_date - p_days_ago) - b.penalty_repaid)
                             from public.loan_book b where b.id = l.id)),
         pg_temp.bank(v_branch), l.member_id, l.id, 'RPY-' || right(p_txn::text, 4), 'Repayment on loan ' || l.loan_no, l.branch_id
  from public.loans l where l.id = p_loan;
  perform pg_temp.attach(p_txn, 'supporting', 'teller.pdf');
  perform public.submit_finance_transaction(p_txn);
  perform pg_temp.act_as('controller@kuun.test');
  perform public.approve_finance_transaction(p_txn);
end $$;

select pg_temp.new_loan('b0000000-0000-0000-0000-000000000001', pg_temp.m(6), 'personal', 300000, 6, 'flat', 2.5, 'salary_earner', 'School fees for the new term');
select pg_temp.new_loan('b0000000-0000-0000-0000-000000000002', pg_temp.m(7), 'business', 1000000, 12, 'reducing_balance', 3, 'business_owner',
  'Restock cement and roofing sheets ahead of the dry season');
insert into public.loan_collaterals (loan_id, branch_id, collateral_type, description, estimated_value, valuation_date, valued_by)
values ('b0000000-0000-0000-0000-000000000002', pg_temp.b(5), 'vehicle', '2016 Toyota Hilux, LAG-482-KJ', 6500000, current_date - 110, 'Ade & Partners Valuers');
select pg_temp.new_loan('b0000000-0000-0000-0000-000000000003', pg_temp.m(6), 'salary_advance', 100000, 3, 'flat', 5, 'salary_earner', 'Medical bills');
select pg_temp.new_loan('b0000000-0000-0000-0000-000000000004', pg_temp.m(1), 'personal', 200000, 6, 'flat', 2.5, 'business_owner', 'Rent for the shop');
select pg_temp.new_loan('b0000000-0000-0000-0000-000000000005', pg_temp.m(13), 'asset', 450000, 10, 'flat', 2.5, 'salary_earner',
  'A laptop and printer for evening tutoring');
insert into public.loan_documents (loan_id, branch_id, document_type, file_name, storage_path, mime_type, size_bytes)
values ('b0000000-0000-0000-0000-000000000005', pg_temp.b(9), 'proforma_invoice', 'proforma.pdf',
        pg_temp.b(9) || '/b0000000-0000-0000-0000-000000000005/seed-proforma.pdf', 'application/pdf', 1024);
select pg_temp.new_loan('b0000000-0000-0000-0000-000000000006', pg_temp.m(10), 'personal', 150000, 4, 'flat', 2.5, 'business_owner', 'Generator repairs');
select pg_temp.new_loan('b0000000-0000-0000-0000-000000000007', pg_temp.m(15), 'business', 400000, 6, 'reducing_balance', 3, 'self_employed',
  'Equipment for a home bakery');
select pg_temp.new_loan('b0000000-0000-0000-0000-000000000008', pg_temp.m(2), 'personal', 250000, 6, 'flat', 2.5, 'business_owner', 'New shop fittings');
select pg_temp.new_loan('b0000000-0000-0000-0000-000000000009', pg_temp.m(4), 'personal', 120000, 4, 'flat', 2.5, 'salary_earner', 'Rent top up');

-- Ada (Ikeja): active, one repayment made, now late. Paid out 75 days ago.
select pg_temp.loan_to('b0000000-0000-0000-0000-000000000001', 'approved', 300000);
select pg_temp.disburse_loan('b0000000-0000-0000-0000-000000000001', '91000000-0000-0000-0000-000000000001', 75);
select pg_temp.repay_loan('b0000000-0000-0000-0000-000000000001', '91000000-0000-0000-0000-000000000002', 57500, 44);
-- Chinedu (Ikeja): active and more than 30 days behind. Paid out 100 days ago, one repayment made.
select pg_temp.loan_to('b0000000-0000-0000-0000-000000000002', 'approved', 1000000);
select pg_temp.disburse_loan('b0000000-0000-0000-0000-000000000002', '91000000-0000-0000-0000-000000000003', 100);
select pg_temp.repay_loan('b0000000-0000-0000-0000-000000000002', '91000000-0000-0000-0000-000000000004', 100462.09, 68);
-- Ada (Ikeja): salary advance repaid in full. Her second instalment was paid about a week late, so the payoff
-- includes the late penalty (posted to 4150 Loan penalty income).
select pg_temp.loan_to('b0000000-0000-0000-0000-000000000003', 'approved', 100000);
select pg_temp.disburse_loan('b0000000-0000-0000-0000-000000000003', '91000000-0000-0000-0000-000000000005', 120);
select pg_temp.repay_loan('b0000000-0000-0000-0000-000000000003', '91000000-0000-0000-0000-000000000006', 38333.33, 90);
select pg_temp.repay_loan('b0000000-0000-0000-0000-000000000003', '91000000-0000-0000-0000-000000000007', 38333.33, 50);
select pg_temp.repay_loan('b0000000-0000-0000-0000-000000000003', '91000000-0000-0000-0000-000000000008', null, 31);
-- Ibrahim (Utako): active and on time, paid out 20 days ago.
select pg_temp.loan_to('b0000000-0000-0000-0000-000000000009', 'approved', 120000);
select pg_temp.disburse_loan('b0000000-0000-0000-0000-000000000009', '91000000-0000-0000-0000-000000000009', 20);
-- Amina (Mabushi Main): approved by Credit and the Head of Business, waiting for Accounts to pay it out.
select pg_temp.loan_to('b0000000-0000-0000-0000-000000000004', 'approved', 180000);
-- Emeka (Mabushi Main): approved by the Head of Credit, waiting for the Head of Business.
select pg_temp.loan_to('b0000000-0000-0000-0000-000000000008', 'credit_approved', 220000);
-- Ebi (Aba Road): appraised, waiting for the Head of Credit.
select pg_temp.loan_to('b0000000-0000-0000-0000-000000000005', 'appraised', 400000);
-- Zainab (Ikoyi): submitted, waiting for the analyst.
select pg_temp.loan_to('b0000000-0000-0000-0000-000000000006', 'submitted', null);
-- Ifeoma (Peter Odili): still a draft with the account officer.

-- Chinedu is more than 30 days behind, so the Head of Credit asks to restructure his loan over a longer term. It waits
-- for the Head of Business; on approval his unpaid interest and late penalty roll into the new schedule.
select pg_temp.act_as('head.credit@kuun.test');
select public.request_loan_restructure('b0000000-0000-0000-0000-000000000002', 18, 'monthly', 3, 'per_month', 'reducing_balance',
  current_date + 21, 'Sales fell after the road works closed his shop front; he can pay a smaller amount over a longer term.');

-- The Lagos account officer reminded Ada about her overdue instalment.
select pg_temp.act_as('credit.lagos@kuun.test');
insert into public.loan_reminders (loan_id, branch_id, kind, channel, amount, note)
values ('b0000000-0000-0000-0000-000000000001', pg_temp.b(5), 'overdue', 'call', 57500, 'Promised to pay at month end');

-- ---------------------------------------------------------------------------
-- HR: employee records for some of the test logins (linked to their logins), a supervisor with no login, and a new
-- starter whose probation and contract end soon.
-- ---------------------------------------------------------------------------

select pg_temp.act_as('head.hr@kuun.test');
insert into public.employees (id, employee_no, status, branch_id, department_code, job_title_id, employment_type, hire_date,
  first_name, last_name, gender, phone, work_email, address, nin, bank_name, bank_account_number)
select e.id, e.no, e.status::public.employee_status, e.branch, e.department, (select id from public.job_titles where name = e.title),
       e.kind, e.hired, e.first_name, e.last_name, e.gender, e.phone, e.email, e.address, e.nin, 'Zenith Bank', e.account
from (values
  ('c0000000-0000-0000-0000-000000000001'::uuid, 'SK-00001', 'active', pg_temp.b(1), 'hr', 'Head of HR', 'permanent', date '2019-03-01',
   'Kunle', 'Head of HR', 'male', '08031110001', 'head.hr@kuun.test', '5 Gana Street, Maitama, Abuja', '22222222201', '2010000001'),
  ('c0000000-0000-0000-0000-000000000002', 'SK-00002', 'active', pg_temp.b(5), 'hr', 'HR Officer', 'permanent',
   date '2022-06-13', 'Hauwa', 'HR Officer', 'female', '08031110002', 'hr.lagos@kuun.test', '14 Ogunlana Drive, Surulere, Lagos', '22222222202', '2010000002'),
  ('c0000000-0000-0000-0000-000000000003', 'SK-00003', 'active', pg_temp.b(5), 'administration',
   'Administrative Officer', 'permanent', date '2021-01-11', 'Oye', 'Officer', 'female', '08031110003', 'officer.ikeja@kuun.test',
   '22 Herbert Macaulay Way, Yaba, Lagos', '22222222203', '2010000003'),
  ('c0000000-0000-0000-0000-000000000004', 'SK-00004', 'active', pg_temp.b(5), 'branch_operations',
   'Branch Manager', 'permanent', date '2018-09-03', 'Mo', 'Manager', 'male', '08031110004', 'manager.ikeja@kuun.test',
   '3 Awolowo Road, Ikoyi, Lagos', '22222222204', '2010000004'),
  ('c0000000-0000-0000-0000-000000000005', 'SK-00005', 'active', pg_temp.b(5), 'credit', 'Account Officer',
   'permanent', date '2023-02-20', 'Kemi', 'Account Officer', 'female', '08031110005', 'credit.lagos@kuun.test',
   '9 Adeniran Ogunsanya, Surulere, Lagos', '22222222205', '2010000005'),
  ('c0000000-0000-0000-0000-000000000006', 'SK-00006', 'active', pg_temp.b(2), 'administration', 'Supervisor',
   'permanent', date '2020-05-04', 'Danjuma', 'Bello', 'male', '08031110006', null, '12 Aminu Kano Crescent, Wuse 2, Abuja', '22222222206', '2010000006'),
  ('c0000000-0000-0000-0000-000000000007', 'SK-00007', 'probation', pg_temp.b(5), 'credit', 'Account Officer',
   'contract', current_date - 160, 'Tobi', 'Adewale', 'male', '08031110007', 'tobi.adewale@kuun.test', '7 Allen Avenue, Ikeja, Lagos',
   '22222222207', '2010000007'),
  ('c0000000-0000-0000-0000-000000000008', 'SK-00008', 'active', pg_temp.b(9), 'branch_operations',
   'Branch Manager', 'permanent', date '2017-04-10', 'Minaibim', 'Manager', 'female', '08031110008', 'manager.abaroad@kuun.test',
   '45 Aba Road, Port Harcourt', '22222222208', '2010000008')
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

-- The Mabushi Annex supervisor was promoted to run the branch, which leaves a promotion on his job history.
select public.change_employee_job('c0000000-0000-0000-0000-000000000006', 'promotion', pg_temp.b(2),
  'administration', (select id from public.job_titles where name = 'Branch Manager'), current_date - 30,
  'Took over Mabushi Annex after the previous manager retired');

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
  ('c0000000-0000-0000-0000-000000000006', 350000, 175000, 80000, 25000, 25000),
  ('c0000000-0000-0000-0000-000000000008', 400000, 200000, 90000, 30000, 30000)
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
where p >= date_trunc('year', current_date)::date;
select public.submit_payroll_run(id) from public.payroll_runs where status = 'draft';
select pg_temp.act_as('controller@kuun.test');
select public.approve_payroll_run(id) from public.payroll_runs where status = 'submitted';

-- Leave: casual leave taken in February, and annual leave in December waiting for the relief officer.
select pg_temp.act_as('hr.lagos@kuun.test');
select public.request_leave((select id from public.leave_types where name = 'Casual leave'),
  make_date(extract(year from current_date)::integer, 2, 10), make_date(extract(year from current_date)::integer, 2, 11),
  'Family wedding', null, null, 'c0000000-0000-0000-0000-000000000005');
select pg_temp.act_as('manager.ikeja@kuun.test');
select public.approve_leave_step(id, 'Enjoy it') from public.leave_requests where employee_id = 'c0000000-0000-0000-0000-000000000005';
select pg_temp.act_as('head.hr@kuun.test');
select public.approve_leave_step(id) from public.leave_requests where employee_id = 'c0000000-0000-0000-0000-000000000005';
select pg_temp.act_as('hr.lagos@kuun.test');
select public.request_leave((select id from public.leave_types where name = 'Annual leave'),
  make_date(extract(year from current_date)::integer, 12, 7), make_date(extract(year from current_date)::integer, 12, 11),
  'End-of-year break', 'c0000000-0000-0000-0000-000000000003', null, 'c0000000-0000-0000-0000-000000000005');

-- A review the Ikeja Branch Manager has submitted for the account officer to acknowledge, and two goals.
select pg_temp.act_as('manager.ikeja@kuun.test');
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
   'Ade and Partners', current_date + 21, current_date + 22, 12, 'Ikeja office training room', 15, 70, '{credit}'),
  ('e0000000-0000-0000-0000-000000000002', 'Customer service excellence', 'Handling member enquiries and complaints.',
   'In-house', current_date + 1, current_date + 1, 6, 'Ikeja office', null, null, '{}');
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
  ('f0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000005', 'Okeke Enterprises', 'Business loan',
   1000000, (date_trunc('month', current_date) - interval '2 months')::date, 'LN-B-001'),
  ('f0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000005', 'Ada Obi', 'Personal loan',
   300000, (date_trunc('month', current_date) - interval '1 month')::date, 'LN-P-002');
select pg_temp.act_as('controller@kuun.test');
select public.decide_commission_sale(id, true) from public.commission_sales where reference = 'LN-B-001';

-- An anonymous concern for Internal Audit to follow up.
select pg_temp.act_as('officer.ikeja@kuun.test');
select public.submit_whistleblowing_report('misconduct', 'Pressure to backdate member files',
  'A colleague has asked twice for KYC files to be dated earlier than they were received, before month-end reporting.',
  null, 'Ikeja office', null, true);

select set_config('request.jwt.claim.sub', '', false);

-- ---------------------------------------------------------------------------
-- Age a few records so dates look real and the Internal Audit exception checks have something to show.
-- Their tables' own triggers are switched off for these updates only, so the audit trail keeps the original history.
-- ---------------------------------------------------------------------------

alter table public.members disable trigger user;
update public.members set created_at = now() - interval '10 days', submitted_at = now() - interval '9 days'
where id in (pg_temp.m(5), pg_temp.m(8));
update public.members set created_at = now() - interval '20 days' where id = pg_temp.m(9);
alter table public.members enable trigger user;

alter table public.finance_transactions disable trigger user;
update public.finance_transactions set created_at = now() - interval '4 days', submitted_at = now() - interval '4 days'
where id = '90000000-0000-0000-0000-000000000003';
alter table public.finance_transactions enable trigger user;

alter table public.bank_statement_lines disable trigger user;
update public.bank_statement_lines set line_date = current_date - 18
where bank_account_id = pg_temp.bank(pg_temp.b(5)) and reference = 'DEP-55120';
alter table public.bank_statement_lines enable trigger user;

-- Loans were raised before they were paid out; the stale application has waited more than a week.
alter table public.loans disable trigger user;
update public.loans
   set created_at = disbursed_on - interval '6 days', submitted_at = disbursed_on - interval '5 days',
       appraised_at = disbursed_on - interval '3 days', approved_at = disbursed_on - interval '2 days', decided_at = disbursed_on - interval '2 days',
       business_approved_at = disbursed_on - interval '1 day'
 where disbursed_on is not null;
update public.loans set created_at = now() - interval '10 days', submitted_at = now() - interval '9 days'
 where id = 'b0000000-0000-0000-0000-000000000006';
alter table public.loans enable trigger user;

-- ---------------------------------------------------------------------------
-- Summary of what was created.
-- ---------------------------------------------------------------------------
select 'members' as what, count(*)::text as how_many, string_agg(distinct status::text, ', ') as states from public.members
union all select 'savings plans', count(*)::text, string_agg(distinct plan_type, ', ') from public.member_plans
union all select 'contributions', count(*)::text, null from public.contributions
union all select 'top ups', count(*)::text, string_agg(distinct status::text, ', ') from public.top_up_requests
union all select 'receipts and payments', count(*)::text, string_agg(distinct status::text, ', ') from public.finance_transactions
union all select 'liquidations', count(*)::text, string_agg(distinct status::text, ', ') from public.plan_liquidations
union all select 'loans', count(*)::text, string_agg(distinct status::text, ', ') from public.loans
union all select 'employees', count(*)::text, null from public.employees;
