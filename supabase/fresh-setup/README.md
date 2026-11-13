# Fresh Supabase setup

Everything a brand-new, empty Supabase project needs to run the Silverkuun ERP, plus test logins and dummy data.

| File | What it does |
| --- | --- |
| `01-schema.sql` | The whole database: all 24 migrations in order (tables, types, functions, triggers, RLS policies, roles and permissions, storage buckets) and the reference data (departments, roles, plan types and rates, loan products, CBN banks, chart of accounts, posting rules, leave types, job titles). No people or branches. |
| `02-seed-organisation.sql` | 3 regions, 10 branches, a bank and a cash account per branch, and 81 test logins: every role, and every branch-level role in every branch. |
| `03-seed-demo-data.sql` | 16 members across all branches and dummy records in every module, created through the real workflow functions. |
| `build-schema.py` | Rebuilds `01-schema.sql` from `supabase/migrations`. Run it after adding a migration. |

## Run order

Run each file once, in order, on a **new, empty** project. None of them is safe to run twice.

1. `01-schema.sql`
2. `02-seed-organisation.sql`
3. `03-seed-demo-data.sql` (skip this on a project that will hold real data)

**With psql (recommended).** Take the connection string from Project Settings > Database > Connection string (Session pooler or direct), then:

```bash
export DB_URL='postgresql://postgres.<project-ref>:<db-password>@<host>:5432/postgres'
psql "$DB_URL" -v ON_ERROR_STOP=1 -1 -f supabase/fresh-setup/01-schema.sql
psql "$DB_URL" -v ON_ERROR_STOP=1 -1 -f supabase/fresh-setup/02-seed-organisation.sql
psql "$DB_URL" -v ON_ERROR_STOP=1 -1 -f supabase/fresh-setup/03-seed-demo-data.sql
```

`-1` runs each file as one transaction, so a failure leaves nothing half-done.

**With the SQL Editor.** Open each file, paste the whole thing into a new query and run it. `01-schema.sql` is large (about 600 KB); if the editor struggles with it, use psql instead.

Afterwards, in the new project:

- Authentication > URL Configuration: set the Site URL to the app's address.
- Authentication > Providers > Email: turn off "Allow new users to sign up". Staff accounts are created by the System Administrator, not by sign-up.
- Point the app at the new project: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` in Vercel (and `.env.local`).

## Test logins

Every login uses the password **`Kuun@Test2026`**.

The logins are inserted straight into Supabase Auth (`auth.users` and `auth.identities`), with the email already confirmed, so no invite emails are sent and they can sign in immediately. They then get a `staff` record and their role. Change the password or delete these accounts before real staff use the system.

### Organisation-wide

| Login | Role |
| --- | --- |
| sysadmin@kuun.test | System Administrator |
| head.ops@kuun.test | Head of Operations (sees every branch, including Operations reports) |
| auditor@kuun.test | Internal Auditor |
| controller@kuun.test | Financial Controller |
| analyst@kuun.test | Credit Analyst |
| head.credit@kuun.test | Head of Credit |
| head.business@kuun.test | Head of Business |
| head.hr@kuun.test | Head of HR |
| payroll@kuun.test | Payroll Officer |
| payments@kuun.test | Payments Accountant (home branch Mabushi Main; pays approved payments for every branch) |

### By region (every branch in the region)

| Role | Abuja | Lagos | Port Harcourt |
| --- | --- | --- | --- |
| Regional Accountant | accountant.abuja@kuun.test | accountant.lagos@kuun.test | accountant.ph@kuun.test |
| Receipts Accountant | receipts.abuja@kuun.test | receipts.lagos@kuun.test | |
| Marketer | marketer.abuja@kuun.test | marketer.lagos@kuun.test | marketer.ph@kuun.test |
| Account Officer (Credit) | credit.abuja@kuun.test | credit.lagos@kuun.test | credit.ph@kuun.test |

### By branch: every department in every branch

Each branch has an Operations Officer, Branch Manager, Marketer, Account Officer (Credit), Receipts Accountant and HR Officer.
The logins follow one pattern, `<role>.<branch>@kuun.test`, and see only their own branch:

| Region | Branch | Operations | Branch Manager | Marketer | Credit | Receipts (Accounts) | HR |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Abuja | Mabushi Main | officer.mabushi | manager.mabushi | marketer.mabushi | credit.mabushi | receipts.mabushi | hr.abuja |
| Abuja | Mabushi Annex | officer.annex | manager.annex | marketer.annex | credit.annex | receipts.annex | hr.annex |
| Abuja | Utako | officer.utako | manager.utako | marketer.utako | credit.utako | receipts.utako | hr.utako |
| Abuja | Kubwa | officer.kubwa | manager.kubwa | marketer.kubwa | credit.kubwa | receipts.kubwa | hr.kubwa |
| Lagos | Ikeja | officer.ikeja | manager.ikeja | marketer.ikeja | credit.ikeja | receipts.ikeja | hr.lagos |
| Lagos | Ikoyi | officer.ikoyi | manager.ikoyi | marketer.ikoyi | credit.ikoyi | receipts.ikoyi | hr.ikoyi |
| Lagos | Yaba | officer.yaba | manager.yaba | marketer.yaba | credit.yaba | receipts.yaba | hr.yaba |
| Lagos | Festac | officer.festac | manager.festac | marketer.festac | credit.festac | receipts.festac | hr.festac |
| Port Harcourt | Aba Road | officer.abaroad | manager.abaroad | marketer.abaroad | credit.abaroad | receipts.abaroad | hr.abaroad |
| Port Harcourt | Peter Odili | officer.odili | manager.odili | marketer.odili | credit.odili | receipts.odili | hr.odili |

Add `@kuun.test` to each. Regional accountants, the payments desk, the Financial Controller, Internal Audit, the Heads of
department, payroll and the System Administrator work across branches, so they have one login each (above). The demo
data was created by the original logins, but every per-branch login sees and works on everything in its branch.

## What the dummy data covers, and where to look

| Area | Records | Try it as |
| --- | --- | --- |
| Member onboarding | Boma (Peter Odili) is a draft; Tunde (Ikeja) is with the marketer; Funke (Ikeja) and Blessing (Kubwa) wait for the Branch Manager; Ngozi (Festac) was sent back; 11 others are approved. | officer.ikeja, marketer.lagos, manager.ikeja, manager.kubwa, officer.festac |
| Savings plans | Silver, Gold, Platinum, Target (3, 6 and 12 months) and Child savings; two Platinum plans mature in 15 days; Amina, Ada and Chinedu are due interest today. | officer.mabushi, officer.ikeja (Interest payments) |
| Contributions | 26, verified by each Branch Manager, except one of Chinedu's that waits in the Ikeja queue. | manager.ikeja |
| Top ups | Ada's logged; Chinedu's and Amina's waiting for the branch officer; Tamuno's logged; one in Yaba sent back to Accounts. | accountant.lagos, officer.ikeja, officer.mabushi |
| Member receipts | Chinedu's cash receipt waits for Ikeja Operations; Emeka's was confirmed and posted; Ebi's was sent back by Aba Road. | officer.ikeja, receipts.lagos, accountant.ph |
| Payments | Bookkeeping fees wait for approval (Mabushi Main); stationery waits for Internal Audit (Ikeja); cleaning waits to be paid (Utako); plumbing was sent back by the payments desk (Peter Odili); rent and internet are paid. | controller, auditor, payments |
| Liquidations | Zainab's Child savings waits for the Ikoyi Branch Manager; Ebi's was sent back; Segun's is approved for Accounts; Ifeoma's payout waits for the Financial Controller; Ibrahim's Target savings is paid. | manager.ikoyi, officer.abaroad, accountant.lagos, controller |
| Accounting | Opening balances posted for Mabushi Main, Ikeja and Aba Road; an Ikeja bank statement to reconcile; a supplier bill; a posting-rule change waiting for the Financial Controller; this month's branch targets. | accountant.lagos, controller, head.ops |
| Loans | One of each stage: draft, submitted, appraised, approved by Credit (waiting for the Head of Business), approved (waiting for payout), active and on time, active and late (Ada, 14 days, running a daily penalty), more than 30 days behind (Chinedu, with a restructure the Head of Credit asked for, waiting for the Head of Business), and repaid (Ada's salary advance, which paid a late penalty). Every application has a landmark. The PAR card and report, and the repayments-due report, have results. | credit.lagos, analyst, head.credit, head.business, accountant.abuja |
| HR | 8 employees (6 linked to logins), salaries, last month's payroll, leave, a performance review, training and commission. | head.hr, hr.lagos, payroll, manager.ikeja |
| Internal Audit | An anonymous whistleblowing report, and records aged so the exception checks show results. | auditor |

Seeded documents are placeholder rows: no file sits behind them, so their download links won't open anything. Files you upload while testing work normally.

Plan interest rates (Silver 10%, Gold 12%, Platinum 15%, Target 12%, Child 10%), the interest formula and the late repayment penalty (0.1% a day on every loan product) are still placeholders until Kuun confirms them.

## How this was checked

On an empty database set up like a new Supabase project (Supabase's own role and extension setup, the Supabase Auth schema, and the storage tables):

- `01-schema.sql` runs cleanly in one transaction, and the result is identical (`pg_dump --schema-only`) to applying the 24 migrations one by one.
- `02` and `03` run cleanly after it, and every seeded password checks out against its stored hash.
- Row-level security scopes the seeded data as expected: the Utako officer sees 1 member, the Ikeja Branch Manager 4, the Lagos marketer 7, the Head of Operations all 16; the Port Harcourt accountant sees 3 transactions and the all-branch payments desk 13.
