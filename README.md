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
cp .env.example .env.local   # fill in your Supabase URL and anon key
npx supabase db push         # apply migrations to the linked Supabase project
npm run dev
```

For local testing, `npx supabase start` (or `npx supabase db reset`) loads `supabase/seed.sql`: two branches and one
test account per role, all with the password `Password123!`.

| Email | Role | Scope |
| --- | --- | --- |
| sysadmin@kuun.test | System Administrator | Whole organisation |
| officer.lagos@kuun.test | Administrative Officer | Lagos |
| manager.lagos@kuun.test | Branch Manager | Lagos |
| head.admin@kuun.test | Head of Administration | Whole organisation |
| auditor@kuun.test | Internal Auditor | Whole organisation |

On a real Supabase project, create the first system administrator by adding a user in Supabase Auth, then running in
the SQL editor:

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
