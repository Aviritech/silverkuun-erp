-- End of Day, End of Month and End of Year (sosa, 2026-11-19).
--
-- The system keeps a business date, separate from the calendar. End of Day (EOD) closes it and opens the next one:
--   1. runs the daily jobs for that date (late loan fees taken from savings, which used to run on its own at 01:00 UTC);
--   2. checks the ledger balances (debits equal credits); it stops if they don't;
--   3. on the last day of a month, runs End of Month (EOM); on 31 December, End of Year (EOY) first;
--   4. saves a day-end report: money in and out, cash and bank, journals by source and by branch, interest due,
--      late fees, the loan book and what was left unfinished;
--   5. marks the day closed and opens the next.
-- EOM saves a month report (profit and loss, financial position, savings, loans) after the month's last day closes.
-- EOY posts closing entries that move each branch's income and expenses for the year into 3200 Accumulated surplus,
-- then saves the year report. The financial year is the calendar year, as the reports already assume.
--
-- A closed day is locked: no journal entry can be posted with a date on or before it. Work that the system posts
-- (receipts, payments, bills, payroll, reversals, late fees) with an earlier date goes onto the open business date
-- instead; the receipt or payment keeps its own date. A manual journal dated in a closed day is refused and must be
-- re-dated. Mistakes in a closed day are corrected by reversing on an open day.
--
-- Who closes: anyone with accounts.day_end.run (the Financial Controller and the new End of Day Officer role) closes
-- the day from Accounts > End of day. If nobody has by the set time (23:00 Lagos by default), the system closes it;
-- the Financial Controller can turn that off or change the time. It also catches up on any earlier days left open.
-- One close for the whole company; branches don't close separately.

-- ---------------------------------------------------------------------------
-- Permission and role
-- ---------------------------------------------------------------------------

insert into public.permissions (code, description) values
  ('accounts.day_end.run', 'Close the business day (End of Day, and End of Month and Year when they fall due) and set the automatic close')
on conflict (code) do nothing;

insert into public.roles (code, department_code, name, description) values
  ('day_end_officer', 'accounts', 'End of Day Officer', 'Closes the business day after checking the day''s work')
on conflict (code) do nothing;

insert into public.role_permissions (role_code, permission_code) values
  ('financial_controller', 'accounts.day_end.run'),
  ('day_end_officer', 'module.accounts'),
  ('day_end_officer', 'accounts.read'),
  ('day_end_officer', 'accounts.day_end.run')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Business days, period closes and the automatic close setting
-- ---------------------------------------------------------------------------

create table if not exists public.business_days (
  business_date date primary key,
  status text not null default 'open' check (status in ('open', 'closed')),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  -- Null when the system closed it.
  closed_by uuid references public.staff (id),
  close_mode text check (close_mode in ('manual', 'automatic')),
  note text,
  report jsonb,
  constraint business_days_closed check ((status = 'closed') = (closed_at is not null and close_mode is not null))
);
-- Only one business day is open at a time.
create unique index if not exists business_days_one_open on public.business_days ((true)) where status = 'open';

create table if not exists public.period_closes (
  id uuid primary key default gen_random_uuid(),
  period_kind text not null check (period_kind in ('month', 'year')),
  period_start date not null,
  period_end date not null,
  closed_at timestamptz not null default now(),
  closed_by uuid references public.staff (id),
  close_mode text not null check (close_mode in ('manual', 'automatic')),
  report jsonb not null,
  -- EOY only: the closing journal entries, one per branch.
  closing_entry_ids uuid[] not null default '{}',
  unique (period_kind, period_end)
);

create table if not exists public.day_end_settings (
  id boolean primary key default true check (id),
  auto_close boolean not null default true,
  auto_close_at time not null default '23:00',
  updated_at timestamptz not null default now(),
  updated_by uuid references public.staff (id)
);
insert into public.day_end_settings (id) values (true) on conflict (id) do nothing;

-- The first business day is the day this runs.
insert into public.business_days (business_date, status)
select current_date, 'open'
where not exists (select 1 from public.business_days);

alter table public.business_days enable row level security;
alter table public.period_closes enable row level security;
alter table public.day_end_settings enable row level security;

-- Read-only to staff; only the functions below write, as the owner.
drop policy if exists "accounts staff read business days" on public.business_days;
create policy "accounts staff read business days" on public.business_days
  for select to authenticated using (app.has_permission('accounts.read'));
drop policy if exists "accounts staff read period closes" on public.period_closes;
create policy "accounts staff read period closes" on public.period_closes
  for select to authenticated using (app.has_permission('accounts.read'));
drop policy if exists "accounts staff read day end settings" on public.day_end_settings;
create policy "accounts staff read day end settings" on public.day_end_settings
  for select to authenticated using (app.has_permission('accounts.read'));
revoke insert, update, delete on public.business_days, public.period_closes, public.day_end_settings from anon, authenticated;
grant select on public.business_days, public.period_closes, public.day_end_settings to authenticated;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'audit_log_changes' and tgrelid = 'public.business_days'::regclass) then
    perform app.enable_audit('public.business_days');
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'audit_log_changes' and tgrelid = 'public.period_closes'::regclass) then
    perform app.enable_audit('public.period_closes');
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'audit_log_changes' and tgrelid = 'public.day_end_settings'::regclass) then
    perform app.enable_audit('public.day_end_settings');
  end if;
end;
$$;

-- The open business date and the last closed one, for every signed-in staff member (shown in the page header).
create or replace function public.business_date_status()
returns table (business_date date, last_closed date, auto_close boolean, auto_close_at time)
language sql
stable
security definer
set search_path = ''
as $$
  select (select d.business_date from public.business_days d where d.status = 'open'),
         (select max(d.business_date) from public.business_days d where d.status = 'closed'),
         s.auto_close, s.auto_close_at
  from public.day_end_settings s;
$$;
revoke all on function public.business_date_status() from public, anon;
grant execute on function public.business_date_status() to authenticated;

-- ---------------------------------------------------------------------------
-- Closed days are locked in the ledger
-- ---------------------------------------------------------------------------

alter table public.journal_entries drop constraint if exists journal_entries_source_check;
alter table public.journal_entries
  add constraint journal_entries_source_check
  check (source in ('manual', 'transaction', 'reversal', 'bill', 'payroll', 'savings_recovery', 'year_end'));

-- Fires before journal_entries_guard (alphabetical). Only posting is checked: drafts can carry any date until posted.
create or replace function app.journal_entries_closed_days()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_through date;
  v_open date;
begin
  if tg_op = 'UPDATE' and old.status = 'posted' then
    if new.entry_date is distinct from old.entry_date then
      raise exception 'a posted entry''s date can''t change' using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;
  if new.status <> 'posted' then
    return new;
  end if;

  -- Wait for an End of Day that is running, so nothing slips into the day it is closing.
  perform 1 from public.business_days where status = 'open' for share;
  select max(business_date) into v_through from public.business_days where status = 'closed';
  if v_through is null or new.entry_date > v_through then
    return new;
  end if;

  select business_date into v_open from public.business_days where status = 'open';
  if new.source = 'manual' then
    raise exception 'the books are closed up to %, so this entry can''t be posted on %; date it % or later',
      to_char(v_through, 'FMDD Mon YYYY'), to_char(new.entry_date, 'FMDD Mon YYYY'),
      to_char(coalesce(v_open, v_through + 1), 'FMDD Mon YYYY')
      using errcode = 'check_violation';
  end if;
  -- Anything else the system posts lands on the open business date.
  new.entry_date := coalesce(v_open, v_through + 1);
  return new;
end;
$$;

drop trigger if exists journal_entries_closed_days on public.journal_entries;
create trigger journal_entries_closed_days
  before insert or update on public.journal_entries
  for each row execute function app.journal_entries_closed_days();

-- ---------------------------------------------------------------------------
-- Reports
-- ---------------------------------------------------------------------------

-- The profit and loss leaves out the year-end closing entries, so a closed year still shows its income and expenses.
-- Opening and closing balances include them, so the financial position stays right.
create or replace function public.account_balances(
  p_from date, p_to date, p_branch_id uuid default null, p_region_id uuid default null,
  p_department text default null, p_plan_type text default null
)
returns table (
  code text, name text, account_type public.account_type, parent_code text, cash_flow_class text,
  opening numeric, debit numeric, credit numeric, closing numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  select a.code, a.name, a.account_type, a.parent_code, a.cash_flow_class,
    coalesce(sum(x.debit - x.credit) filter (where x.entry_date < p_from), 0)::numeric(16, 2),
    coalesce(sum(x.debit) filter (where x.entry_date between p_from and p_to
      and not (x.year_end and a.account_type in ('income', 'expense'))), 0)::numeric(16, 2),
    coalesce(sum(x.credit) filter (where x.entry_date between p_from and p_to
      and not (x.year_end and a.account_type in ('income', 'expense'))), 0)::numeric(16, 2),
    coalesce(sum(x.debit - x.credit) filter (where x.entry_date <= p_to), 0)::numeric(16, 2)
  from public.ledger_accounts a
  left join (
    select l.account_code, l.debit, l.credit, e.entry_date, e.source = 'year_end' as year_end
    from public.journal_lines l
    join public.journal_entries e on e.id = l.entry_id and e.status = 'posted'
    join public.branches b on b.id = l.branch_id
    where (p_branch_id is null or l.branch_id = p_branch_id)
      and (p_region_id is null or b.region_id = p_region_id)
      and (p_department is null or l.department_code = p_department)
      and (p_plan_type is null or l.plan_type = p_plan_type)
  ) x on x.account_code = a.code
  where not a.is_group
  group by a.code
  order by a.code;
$$;

-- Figures for a period (one day, a month or a year), as a JSON report. Runs as the owner, for the close functions.
create or replace function app.period_figures(p_from date, p_to date)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with lines as (
    select l.branch_id, l.account_code, a.account_type, a.cash_flow_class, l.debit, l.credit, e.entry_date, e.source, e.id as entry_id
    from public.journal_lines l
    join public.journal_entries e on e.id = l.entry_id and e.status = 'posted' and e.entry_date <= p_to
    join public.ledger_accounts a on a.code = l.account_code
  ),
  moves as (select * from lines where entry_date >= p_from),
  pl as (select * from moves where source <> 'year_end' and account_type in ('income', 'expense')),
  txns as (
    select t.direction, t.amount
    from public.finance_transactions t
    join public.journal_entries e on e.transaction_id = t.id and e.source = 'transaction' and e.status = 'posted'
    where e.entry_date between p_from and p_to
  )
  select jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'ledger', (select jsonb_build_object(
        'entries', count(distinct entry_id),
        'debits', coalesce(sum(debit), 0)::numeric(16, 2),
        'credits', coalesce(sum(credit), 0)::numeric(16, 2)) from moves),
    'trial_balance', (select jsonb_build_object(
        'debits', coalesce(sum(debit), 0)::numeric(16, 2),
        'credits', coalesce(sum(credit), 0)::numeric(16, 2)) from lines),
    'by_source', (select coalesce(jsonb_agg(jsonb_build_object('source', source, 'entries', n, 'amount', amount) order by source), '[]')
        from (select source, count(distinct entry_id) as n, sum(debit)::numeric(16, 2) as amount from moves group by source) s),
    'receipts', (select jsonb_build_object('count', count(*), 'amount', coalesce(sum(amount), 0)::numeric(16, 2))
        from txns where direction = 'receipt'),
    'payments', (select jsonb_build_object('count', count(*), 'amount', coalesce(sum(amount), 0)::numeric(16, 2))
        from txns where direction = 'payment'),
    'cash', (select jsonb_build_object(
        'opening', coalesce(sum(debit - credit) filter (where entry_date < p_from), 0)::numeric(16, 2),
        'money_in', coalesce(sum(debit) filter (where entry_date >= p_from), 0)::numeric(16, 2),
        'money_out', coalesce(sum(credit) filter (where entry_date >= p_from), 0)::numeric(16, 2),
        'closing', coalesce(sum(debit - credit), 0)::numeric(16, 2))
        from lines where cash_flow_class = 'cash'),
    'profit_and_loss', (select jsonb_build_object(
        'income', coalesce(sum(credit - debit) filter (where account_type = 'income'), 0)::numeric(16, 2),
        'expenses', coalesce(sum(debit - credit) filter (where account_type = 'expense'), 0)::numeric(16, 2),
        'surplus', coalesce(sum(credit - debit), 0)::numeric(16, 2)) from pl),
    'position', (select jsonb_build_object(
        'assets', coalesce(sum(debit - credit) filter (where account_type = 'asset'), 0)::numeric(16, 2),
        'liabilities', coalesce(sum(credit - debit) filter (where account_type = 'liability'), 0)::numeric(16, 2),
        'funds', coalesce(sum(credit - debit) filter (where account_type in ('equity', 'income', 'expense')), 0)::numeric(16, 2),
        'member_savings', coalesce(sum(credit - debit) filter (where account_code in ('2110', '2120')), 0)::numeric(16, 2),
        'loans_outstanding', coalesce(sum(debit - credit) filter (where account_code in ('1210', '1220')), 0)::numeric(16, 2))
        from lines),
    'by_branch', (select coalesce(jsonb_agg(jsonb_build_object(
          'branch', b.name, 'entries', x.entries, 'debits', x.debits,
          'money_in', x.money_in, 'money_out', x.money_out, 'surplus', x.surplus) order by b.name), '[]')
        from (
          select m.branch_id, count(distinct m.entry_id) as entries, sum(m.debit)::numeric(16, 2) as debits,
                 coalesce(sum(m.debit) filter (where m.cash_flow_class = 'cash'), 0)::numeric(16, 2) as money_in,
                 coalesce(sum(m.credit) filter (where m.cash_flow_class = 'cash'), 0)::numeric(16, 2) as money_out,
                 coalesce(sum(m.credit - m.debit) filter (where m.account_type in ('income', 'expense') and m.source <> 'year_end'), 0)
                   ::numeric(16, 2) as surplus
          from moves m group by m.branch_id
        ) x join public.branches b on b.id = x.branch_id),
    'late_fees_from_savings', (select jsonb_build_object('count', count(*), 'amount', coalesce(sum(r.amount), 0)::numeric(16, 2))
        from public.loan_penalty_recoveries r where r.recovered_on between p_from and p_to),
    'loans', (select jsonb_build_object(
        'active', count(*) filter (where status = 'active'),
        'disbursed', count(*) filter (where disbursed_on between p_from and p_to),
        'outstanding_principal', coalesce(sum(outstanding_principal) filter (where status = 'active'), 0)::numeric(16, 2),
        'overdue', coalesce(sum(overdue_amount) filter (where status = 'active'), 0)::numeric(16, 2),
        'par30', coalesce(sum(outstanding_principal) filter (where status = 'active' and days_past_due > 30), 0)::numeric(16, 2),
        'penalty_outstanding', coalesce(sum(penalty_outstanding) filter (where status = 'active'), 0)::numeric(16, 2))
        from public.loan_book)
  );
$$;
revoke all on function app.period_figures(date, date) from public, anon, authenticated;

-- What a day-end adds to the period figures: interest due that day and the work still in progress.
create or replace function app.day_end_report(p_date date)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select app.period_figures(p_date, p_date) || jsonb_build_object(
    'interest_due', (select jsonb_build_object('members', count(*), 'amount', coalesce(sum(s.amount), 0)::numeric(16, 2))
        from public.interest_payment_schedule(p_date) s),
    'unfinished', jsonb_build_object(
      'transactions_draft', (select count(*) from public.finance_transactions where status in ('draft', 'returned')),
      'transactions_submitted', (select count(*) from public.finance_transactions where status = 'submitted'),
      'transactions_approved', (select count(*) from public.finance_transactions where status = 'approved'),
      'journals_draft', (select count(*) from public.journal_entries where status = 'draft' and entry_date <= p_date),
      'pay_ins_to_post', (select count(*) from public.contributions_awaiting_posting)
    )
  );
$$;
revoke all on function app.day_end_report(date) from public, anon, authenticated;

-- The open day's figures so far and its unfinished work, for the End of Day page before closing.
create or replace function public.day_end_preview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_date date;
begin
  if not app.has_permission('accounts.read') then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  select business_date into v_date from public.business_days where status = 'open';
  return app.day_end_report(v_date);
end;
$$;
revoke all on function public.day_end_preview() from public, anon;
grant execute on function public.day_end_preview() to authenticated;

-- ---------------------------------------------------------------------------
-- End of Year: move each branch's income and expenses for the year into accumulated surplus
-- ---------------------------------------------------------------------------

create or replace function app.close_year(p_year_end date, p_by uuid)
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_was_on boolean := app.in_workflow();
  v_branch uuid;
  v_entry_id uuid;
  v_ids uuid[] := '{}';
  v_line integer;
  v_row record;
begin
  perform app.begin_workflow();
  for v_branch in
    select distinct l.branch_id
    from public.journal_lines l
    join public.journal_entries e on e.id = l.entry_id and e.status = 'posted' and e.entry_date <= p_year_end
    join public.ledger_accounts a on a.code = l.account_code and a.account_type in ('income', 'expense')
    group by l.branch_id, l.account_code, l.department_code, l.plan_type
    having sum(l.debit - l.credit) <> 0
  loop
    insert into public.journal_entries (branch_id, entry_date, description, source, status, created_by, posted_by, posted_at)
    values (v_branch, p_year_end,
            'End of Year ' || extract(year from p_year_end) || ': income and expenses closed to accumulated surplus',
            'year_end', 'draft', p_by, p_by, now())
    returning id into v_entry_id;

    v_line := 0;
    -- Every income and expense balance to nil, then the net to 3200, kept by department and product.
    for v_row in
      select l.account_code, l.department_code, l.plan_type, sum(l.debit - l.credit)::numeric(16, 2) as balance
      from public.journal_lines l
      join public.journal_entries e on e.id = l.entry_id and e.status = 'posted' and e.entry_date <= p_year_end
      join public.ledger_accounts a on a.code = l.account_code and a.account_type in ('income', 'expense')
      where l.branch_id = v_branch
      group by l.account_code, l.department_code, l.plan_type
      having sum(l.debit - l.credit) <> 0
      order by l.account_code
    loop
      v_line := v_line + 1;
      insert into public.journal_lines (entry_id, line_no, account_code, debit, credit, department_code, plan_type, description)
      values (v_entry_id, v_line, v_row.account_code, greatest(-v_row.balance, 0), greatest(v_row.balance, 0),
              v_row.department_code, v_row.plan_type, 'Closed to accumulated surplus');
    end loop;
    for v_row in
      select l.department_code, l.plan_type, sum(l.debit - l.credit)::numeric(16, 2) as balance
      from public.journal_lines l
      join public.journal_entries e on e.id = l.entry_id and e.status = 'posted' and e.entry_date <= p_year_end
      join public.ledger_accounts a on a.code = l.account_code and a.account_type in ('income', 'expense')
      where l.branch_id = v_branch
      group by l.department_code, l.plan_type
      having sum(l.debit - l.credit) <> 0
    loop
      v_line := v_line + 1;
      -- A surplus (credit balance overall) is credited to 3200; a deficit debited.
      insert into public.journal_lines (entry_id, line_no, account_code, debit, credit, department_code, plan_type, description)
      values (v_entry_id, v_line, '3200', greatest(v_row.balance, 0), greatest(-v_row.balance, 0),
              v_row.department_code, v_row.plan_type,
              case when v_row.balance <= 0 then 'Surplus for ' else 'Deficit for ' end || extract(year from p_year_end));
    end loop;

    if v_line < 2 then
      -- Income and expenses that net to nil within each dimension still leave lines; anything less is nothing to close.
      delete from public.journal_entries where id = v_entry_id;
      continue;
    end if;
    perform app.assert_balanced(v_entry_id);
    update public.journal_entries set status = 'posted' where id = v_entry_id;
    v_ids := v_ids || v_entry_id;
  end loop;

  if not v_was_on then
    perform app.end_workflow();
  end if;
  return v_ids;
end;
$$;
revoke all on function app.close_year(date, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- End of Day (with End of Month and End of Year when they fall due)
-- ---------------------------------------------------------------------------

create or replace function app.close_business_day(p_by uuid, p_mode text, p_note text)
returns public.business_days
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day public.business_days;
  v_date date;
  v_month_start date;
  v_closing uuid[] := '{}';
  v_tb jsonb;
begin
  select * into v_day from public.business_days where status = 'open' for update;
  if not found then
    raise exception 'there is no open business day' using errcode = 'no_data_found';
  end if;
  v_date := v_day.business_date;
  if v_date > current_date then
    raise exception '% hasn''t started yet, so it can''t be closed', to_char(v_date, 'FMDD Mon YYYY') using errcode = 'check_violation';
  end if;

  -- 1. The daily jobs for this date.
  perform app.recover_loan_penalties_from_savings(v_date);

  -- 2. The ledger must balance.
  v_tb := app.period_figures(v_date, v_date) -> 'trial_balance';
  if (v_tb ->> 'debits')::numeric <> (v_tb ->> 'credits')::numeric then
    raise exception 'the books don''t balance (debits %, credits %); End of Day has stopped. Tell the Financial Controller',
      v_tb ->> 'debits', v_tb ->> 'credits' using errcode = 'check_violation';
  end if;

  -- 3. Month end and year end.
  if v_date = (date_trunc('month', v_date) + interval '1 month - 1 day')::date then
    v_month_start := date_trunc('month', v_date)::date;
    if extract(month from v_date) = 12 then
      v_closing := app.close_year(v_date, p_by);
      insert into public.period_closes (period_kind, period_start, period_end, closed_by, close_mode, report, closing_entry_ids)
      values ('year', make_date(extract(year from v_date)::integer, 1, 1), v_date, p_by, p_mode,
              app.period_figures(make_date(extract(year from v_date)::integer, 1, 1), v_date), v_closing);
    end if;
    insert into public.period_closes (period_kind, period_start, period_end, closed_by, close_mode, report)
    values ('month', v_month_start, v_date, p_by, p_mode,
            app.period_figures(v_month_start, v_date)
              || jsonb_build_object('days_closed', (select count(*) + 1 from public.business_days
                                                     where status = 'closed' and business_date between v_month_start and v_date)));
  end if;

  -- 4 and 5. Save the report, close the day and open the next.
  update public.business_days
     set status = 'closed', closed_at = now(), closed_by = p_by, close_mode = p_mode,
         note = nullif(trim(coalesce(p_note, '')), ''), report = app.day_end_report(v_date)
   where business_date = v_date
  returning * into v_day;
  insert into public.business_days (business_date, status) values (v_date + 1, 'open');
  return v_day;
end;
$$;
revoke all on function app.close_business_day(uuid, text, text) from public, anon, authenticated;

-- Closes the open business day, for staff with accounts.day_end.run.
create or replace function public.run_end_of_day(p_note text default null)
returns public.business_days
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.has_permission('accounts.day_end.run') then
    raise exception 'only the Financial Controller or an End of Day Officer can close the day' using errcode = 'insufficient_privilege';
  end if;
  return app.close_business_day(auth.uid(), 'manual', p_note);
end;
$$;
revoke all on function public.run_end_of_day(text) from public, anon;
grant execute on function public.run_end_of_day(text) to authenticated;

-- Run every 15 minutes. With the automatic close on, closes every open day before today, and today once the set time
-- (Lagos) has passed. Returns how many days it closed.
create or replace function app.auto_end_of_day()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings public.day_end_settings;
  v_now timestamp := now() at time zone 'Africa/Lagos';
  v_count integer := 0;
  v_open date;
begin
  select * into v_settings from public.day_end_settings;
  if not coalesce(v_settings.auto_close, false) then
    return 0;
  end if;
  loop
    select business_date into v_open from public.business_days where status = 'open';
    exit when v_open is null or v_open > current_date;
    exit when v_open >= v_now::date and v_now::time < v_settings.auto_close_at;
    perform app.close_business_day(null, 'automatic', null);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
revoke all on function app.auto_end_of_day() from public, anon, authenticated;

create or replace function public.set_day_end_settings(p_auto_close boolean, p_auto_close_at time)
returns public.day_end_settings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings public.day_end_settings;
begin
  if not app.has_permission('accounts.config.manage') then
    raise exception 'only the Financial Controller can change the automatic close' using errcode = 'insufficient_privilege';
  end if;
  if p_auto_close is null or p_auto_close_at is null then
    raise exception 'say whether the day closes automatically, and when' using errcode = 'check_violation';
  end if;
  update public.day_end_settings
     set auto_close = p_auto_close, auto_close_at = p_auto_close_at, updated_at = now(), updated_by = auth.uid()
   where id
  returning * into v_settings;
  return v_settings;
end;
$$;
revoke all on function public.set_day_end_settings(boolean, time) from public, anon;
grant execute on function public.set_day_end_settings(boolean, time) to authenticated;

-- ---------------------------------------------------------------------------
-- Schedule: End of Day replaces the separate nightly late-fee job
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
    if exists (select 1 from cron.job where jobname = 'loan-late-fees-from-savings') then
      perform cron.unschedule('loan-late-fees-from-savings');
    end if;
    perform cron.schedule('end-of-day', '*/15 * * * *', 'select app.auto_end_of_day()');
  end if;
end;
$$;
