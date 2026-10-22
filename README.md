# Silverkuun ERP

A departmental workspace for Silverkuun Group, built by Aviritech. Each department signs in to its own module,
and records flow between departments through one shared database.

## Stack

| Part | Choice | Why |
| --- | --- | --- |
| App | Next.js 15 (App Router, TypeScript) on Vercel | Server-rendered pages, server actions, no separate API to secure |
| Database, login, files | Supabase (Postgres, Auth, Storage) | Row level security enforces access in the database itself |
| Background jobs | Railway (from step 2) | PDF letters, maturity reminders and scheduled reports |

## How access works

- **Staff** are created by a system administrator. Public sign-up is turned off.
- A staff member holds one or more **roles** (for example *Branch Manager*). Each role grants **permissions**
  (for example `module.administration`).
- Each role assignment is scoped to **one branch, one region, or the whole organisation**. A Lagos branch manager can
  act only on Lagos records; an internal auditor's organisation-wide role covers every branch.
- Every table has row level security on, so the database refuses anything a policy doesn't allow, even if the app
  has a bug.
- Every insert, update and delete on an audited table is written to `audit_log` with who, when, the fields that
  changed, and the before and after values. The log is append-only: nobody, including the database owner, can edit
  or delete it.

Roles and permissions are defined in migrations rather than edited in the app, so every change to who-can-do-what
is reviewed in git.

## Adding a department

1. Add a migration in `supabase/migrations/` that inserts the department, its permissions (including
   `module.<department>`) and roles, creates its tables with row level security, and calls
   `select app.enable_audit('public.<table>')` for each table.
2. Create `src/modules/<department>/module.ts` describing the module and its navigation, and add it to
   `src/modules/registry.ts`.
3. Add its pages under `src/app/(app)/<department>/`, starting each page with `requireModule(...)`.

## Running locally

```bash
npm install
cp .env.example .env.local   # fill in your Supabase URL, anon key and service role key
npx supabase db push         # apply migrations to the linked Supabase project
npm run dev
```

For local testing, `npx supabase start` (or `npx supabase db reset`) loads `supabase/seed.sql`: two branches, one
test account per role, and demo records in every department (members at each stage, contributions, a posted opening
journal, a paid payment, a payment waiting for approval, and an imported bank statement). Every account uses the
password `Password123!`.

**After pulling new code, apply new migrations** before running the app, or pages fail with "This database is
missing part of the ERP's schema":

```bash
npx supabase migration up   # applies new migrations and keeps your local data
npx supabase db reset       # or start over: rebuilds the database and reloads the demo data
```

| Email | Role | Scope |
| --- | --- | --- |
| sysadmin@kuun.test | System Administrator | Whole organisation |
| officer.lagos@kuun.test | Administrative Officer | Lagos |
| manager.lagos@kuun.test | Branch Manager | Lagos |
| head.admin@kuun.test | Head of Administration | Whole organisation |
| auditor@kuun.test | Internal Auditor (read-only; also reads Accounts) | Whole organisation |
| accountant.lagos@kuun.test | Regional Accountant (records, requests, approves, pays, reconciles) | Lagos |
| receipts.abuja@kuun.test | Receipts Accountant | Abuja |
| payments.abuja@kuun.test | Payments Accountant | Abuja |
| controller@kuun.test | Financial Controller (approves, posts journals, settings) | Whole organisation |
| credit.lagos@kuun.test | Account Officer (raises applications, reminders, restructure requests) | Lagos |
| credit.abuja@kuun.test | Account Officer | Abuja |
| analyst@kuun.test | Credit Analyst (bureau check, risk rating, recommendation) | Whole organisation |
| head.credit@kuun.test | Head of Credit (approves loans and restructures, loan products) | Whole organisation |
| hr.lagos@kuun.test | HR Officer (employee records, documents, contracts, ERP logins) | Lagos |
| head.hr@kuun.test | Head of HR (confirms, transfers, promotes, records exits, job titles) | Whole organisation |
| payroll@kuun.test | Payroll Officer (salaries, deductions, monthly payroll) | Whole organisation |

## Departments

- **Administration**: member files, KYC documents, plans and contributions, with the Branch Manager's drawn signature on
  approval; expected against paid per plan; maturities; issued letters and statements; monthly branch targets; and
  reports (contribution schedule, maturities, issued documents, member register).
- **Accounts**: receipts and payment requests with evidence and maker-checker approval, posting to a double-entry
  ledger through posting rules that change only when a second person approves; department, product, staff, supplier
  and currency on each transaction; suppliers and supplier bills (Dr expense, Cr payables) paid against the bill;
  verified Administration contributions flow in to be posted; manual journals with reversal and an ROI accrual screen;
  bank statement import (Excel or CSV) with suggestions that learn from earlier postings, auto-matching and
  reconciliation sign-off; financial reports (profit and loss, financial position, cash flow, trial balance, general
  ledger, member balances, register, payables aging, bank reconciliations).
- **Credit**: loan applications (customer, employment or business, amount, purpose, tenor and frequency, rate and
  method, repayment mode, guarantors, collateral with valuation, documents and proforma invoice) that move from the
  account officer to a credit analyst's appraisal (bureau check, risk rating, recommendation) to the Head of Credit's
  decision, each step by a different person; loan products with limits and requirements; approved loans are paid out
  by Accounts through a normal payment request, which activates the loan and fixes its repayment schedule (flat or
  reducing balance; weekly, monthly, quarterly or at the end); repayments are receipted by Accounts against the loan
  and the database splits them into interest and principal, oldest instalment first; arrears, missed repayments and
  days past due; reminders for upcoming and overdue instalments; restructures approved by a second person; a dashboard
  filterable by branch, officer, product, customer category and period; and reports (portfolio and PAR with suggested
  provision, overdue loans, applications, approvals and disbursements, repayments against what fell due, officer
  performance, repayments falling due). Seven demo loans cover every stage.
- **Human Resources**:
  - *Employee records* for everyone on the staff, whether or not they use the ERP: personal details, identification,
    emergency contact, bank, pension and tax details, dependents, qualifications (with expiry dates for
    certifications), passport photo and documents; contracts, where a new contract ends the one before; confirmation
    after probation, transfers, promotions, exits and reinstatement by the Head of HR, each on a dated job history; and
    ERP logins created from the record, switched off the moment an exit is recorded.
  - *Leave*: leave types with yearly days (pro-rated for new starters, extra days for long service), public holidays,
    and requests counted in working days. Requests go first to the colleague covering the work, then up the approval
    chain by job title (supervisor, branch manager, regional manager, business development manager, HR), each step
    limited to the same branch, region or department as set; steps nobody holds are skipped, and the Head of HR decides
    when the whole chain is empty. Pending requests hold their days, so the balance can't be spent twice.
  - *Payroll*: salaries proposed and approved by different people; recurring deductions (an advance stops once it is
    recovered); a monthly run that pro-rates joiners and leavers and works out pension (8% employee, 10% employer on
    basic, housing and transport), NHF (2.5% of basic) and PAYE on the Nigeria Tax Act 2025 bands after rent relief,
    with one-off pay taxed at the rate it adds. The Financial Controller approves the run, which posts one journal per
    branch (staff costs by department against net pay, PAYE, pension, NHF and deductions payable); Accounts then pays
    salaries and remits the deductions as ordinary payments. Rates and bands are dated settings the Financial
    Controller keeps. Employees see their payslips once the run is approved.
  - *Performance*: reviews scored 1 to 5 per criterion by branch and department heads, acknowledged by the employee
    with their comments; goals with progress.
  - *Training*: scheduled courses that staff enrol in themselves (for their department, while there is room), results
    and scores recorded by HR, feedback, and a printable certificate.
  - *Commission*: targets with their terms (a percentage of sales, a percentage or flat amount when met, or tiered),
    sales recorded by the employee and approved by someone else, and the commission paid through the next payroll.
  - *Speak up*: any staff member can report a concern, named or anonymous, to Internal Audit and follow it up with a
    reference and access code. Anonymous reports keep nothing about who sent them.
  - *My HR* for every employee: their record, leave balances and requests, approvals waiting for them, payslips,
    reviews and goals, training and commission.
  - Reports: staff register, headcount and turnover, leave register and balances, payroll register, bank payment
    schedule, PAYE, pension and NHF schedules, training register and commission summary.
- **System Administration**: staff logins and the roles that give access, each for a branch, a region or the whole
  organisation; password resets with a temporary password; switching logins off; and regions, branches and
  departments. Anyone given a temporary password chooses their own the first time they sign in.
- Every report downloads as Excel (.xlsx), PDF or CSV.
- **Internal Audit**: read-only dashboard, exception checks (incomplete KYC, stale approvals, large transactions,
  segregation breaches, unmatched bank lines, changes after approval, deletions, overdue loans, stale loan applications,
  approved loans not paid out), read-only access to the loan book, customer register, branch
  operations reports, the audit trail, and a per-record history showing every change with before and after values.

On a real Supabase project, create the first system administrator by adding a user in Supabase Auth, then running in
the SQL editor (after that, everything is done in the app: System Administration for logins, roles and branches, and
Human Resources for employees):

```sql
insert into public.regions (code, name) values ('HQ', 'Head Office');
insert into public.branches (region_id, code, name) select id, 'HQ', 'Head Office' from public.regions where code = 'HQ';
insert into public.staff (id, full_name, email, department_code)
  select id, 'Your Name', email, 'system' from auth.users where email = 'you@example.com';
insert into public.staff_roles (staff_id, role_code)
  select id, 'system_admin' from public.staff where email = 'you@example.com';
```

## Checks

```bash
npm run lint
npm run typecheck
npm test        # unit tests plus database tests that run every migration and check the access rules
npm run build
```

The database tests run the real migrations in an in-memory Postgres ([PGlite](https://pglite.dev)), so they need
no Docker or Supabase project.
