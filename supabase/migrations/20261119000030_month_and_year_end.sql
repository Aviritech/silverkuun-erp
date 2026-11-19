-- End of Month and End of Year (sosa, 2026-11-19: "just end of month and end of year", no daily close).
--
-- End of Month (EOM) closes a month once it has ended:
--   1. checks the ledger balances (debits equal credits); it stops if they don't;
--   2. in December, runs End of Year (EOY) first: closing entries move each branch's income and expenses for the
--      year into 3200 Accumulated surplus (kept by department and product), and the year report is saved;
--   3. saves the month report: money in and out, cash and bank, profit and loss, financial position, journals by
--      source and by branch, the loan book, late fees taken from savings, and work left unfinished;
--   4. locks the month.
-- Months close in order, one at a time. The financial year is the calendar year, as the reports already assume.
--
-- A closed month is locked: no journal entry can be posted with a date in it. Work the system posts (receipts,
-- payments, bills, payroll, reversals, late fees) with a date in a closed month goes onto the first day after the
-- last closed month instead; the receipt or payment keeps its own date. A manual journal dated in a closed month is
-- refused and must be re-dated. Mistakes are corrected by reversing in an open month.
--
-- Who closes: anyone with accounts.period_close.run, which is the Financial Controller and the new Month-end Officer
-- role. Nothing closes automatically. One close for the whole company.

insert into public.permissions (code, description) values
  ('accounts.period_close.run', 'Close a month (End of Month, and End of Year in December)')
on conflict (code) do nothing;

insert into public.roles (code, department_code, name, description) values
  ('month_end_officer', 'accounts', 'Month-end Officer', 'Closes the month, and the year in December, after checking the books')
on conflict (code) do nothing;

insert into public.role_permissions (role_code, permission_code) values
  ('financial_controller', 'accounts.period_close.run'),
  ('month_end_officer', 'module.accounts'),
  ('month_end_officer', 'accounts.read'),
  ('month_end_officer', 'accounts.period_close.run')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Month and year closes
-- ---------------------------------------------------------------------------

create table if not exists public.period_closes (
  id uuid primary key default gen_random_uuid(),
  period_kind text not null check (period_kind in ('month', 'year')),
  period_start date not null,
  period_end date not null,
  closed_at timestamptz not null default now(),
  closed_by uuid not null references public.staff (id),
  note text,
  report jsonb not null,
  -- EOY only: the closing journal entries, one per branch.
  closing_entry_ids uuid[] not null default '{}',
  unique (period_kind, period_end)
);

alter table public.period_closes enable row level security;
drop policy if exists "accounts staff read period closes" on public.period_closes;
create policy "accounts staff read period closes" on public.period_closes
  for select to authenticated using (app.has_permission('accounts.read'));
revoke insert, update, delete on public.period_closes from anon, authenticated;
grant select on public.period_closes to authenticated;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'audit_log_changes' and tgrelid = 'public.period_closes'::regclass) then
    perform app.enable_audit('public.period_closes');
  end if;
end;
$$;

-- The last day of the last closed month, or null before any month has closed.
create or replace function app.books_closed_through()
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select max(period_end) from public.period_closes where period_kind = 'month';
$$;

-- The month to close next: the one after the last closed month, or last month before any has closed.
create or replace function public.next_month_to_close()
returns table (period_start date, period_end date, closed_through date, has_ended boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with t as (
    select app.books_closed_through() as through,
           (now() at time zone 'Africa/Lagos')::date as today
  ),
  m as (
    select coalesce(t.through + 1, (date_trunc('month', t.today) - interval '1 month')::date) as start, t.through, t.today from t
  )
  select m.start, (m.start + interval '1 month - 1 day')::date, m.through,
         (m.start + interval '1 month - 1 day')::date < m.today
  from m;
$$;
revoke all on function public.next_month_to_close() from public, anon;
grant execute on function public.next_month_to_close() to authenticated;

-- ---------------------------------------------------------------------------
-- Closed months are locked in the ledger
-- ---------------------------------------------------------------------------

alter table public.journal_entries drop constraint if exists journal_entries_source_check;
alter table public.journal_entries
  add constraint journal_entries_source_check
  check (source in ('manual', 'transaction', 'reversal', 'bill', 'payroll', 'savings_recovery', 'year_end'));

-- Fires before journal_entries_guard (alphabetical). Only posting is checked: drafts can carry any date until posted.
create or replace function app.journal_entries_closed_periods()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_through date;
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

  -- Wait for a month-end close that is running, so nothing slips into the month it is closing.
  perform pg_advisory_xact_lock_shared(hashtext('period_close'));
  v_through := app.books_closed_through();
  if v_through is null or new.entry_date > v_through then
    return new;
  end if;
  -- The year-end closing entries are dated the last day of the year while that month is being closed.
  if new.source = 'year_end' then
    return new;
  end if;
  if new.source = 'manual' then
    raise exception 'the books are closed up to %, so this entry can''t be posted on %; date it % or later',
      to_char(v_through, 'FMDD Mon YYYY'), to_char(new.entry_date, 'FMDD Mon YYYY'), to_char(v_through + 1, 'FMDD Mon YYYY')
      using errcode = 'check_violation';
  end if;
  -- Anything else the system posts lands on the first open day.
  new.entry_date := v_through + 1;
  return new;
end;
$$;

drop trigger if exists journal_entries_closed_periods on public.journal_entries;
create trigger journal_entries_closed_periods
  before insert or update on public.journal_entries
  for each row execute function app.journal_entries_closed_periods();

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


-- Work still in progress, saved with the month report.
create or replace function app.unfinished_work(p_through date)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'transactions_draft', (select count(*) from public.finance_transactions where status in ('draft', 'returned')),
    'transactions_submitted', (select count(*) from public.finance_transactions where status = 'submitted'),
    'transactions_approved', (select count(*) from public.finance_transactions where status = 'approved'),
    'journals_draft', (select count(*) from public.journal_entries where status = 'draft' and entry_date <= p_through),
    'pay_ins_to_post', (select count(*) from public.contributions_awaiting_posting)
  );
$$;
revoke all on function app.unfinished_work(date) from public, anon, authenticated;

-- The next month's figures so far and the unfinished work, for the page before closing.
create or replace function public.month_end_preview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_next record;
begin
  if not app.has_permission('accounts.read') then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  select * into v_next from public.next_month_to_close();
  return app.period_figures(v_next.period_start, v_next.period_end)
    || jsonb_build_object('unfinished', app.unfinished_work(v_next.period_end));
end;
$$;
revoke all on function public.month_end_preview() from public, anon;
grant execute on function public.month_end_preview() to authenticated;

-- ---------------------------------------------------------------------------
-- End of Month (with End of Year in December)
-- ---------------------------------------------------------------------------

-- Closes the next month (p_month_end must be its last day, so a page left open can't close the wrong month).
create or replace function public.run_month_end(p_month_end date, p_note text default null)
returns public.period_closes
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_next record;
  v_close public.period_closes;
  v_closing uuid[] := '{}';
  v_tb jsonb;
  v_year_start date;
begin
  if not app.has_permission('accounts.period_close.run') then
    raise exception 'only the Financial Controller or a Month-end Officer can close the month' using errcode = 'insufficient_privilege';
  end if;
  -- One close at a time; postings wait for it (see journal_entries_closed_periods).
  perform pg_advisory_xact_lock(hashtext('period_close'));
  select * into v_next from public.next_month_to_close();
  if p_month_end is distinct from v_next.period_end then
    raise exception 'the next month to close is the one ending %', to_char(v_next.period_end, 'FMDD Mon YYYY')
      using errcode = 'check_violation';
  end if;
  if not v_next.has_ended then
    raise exception '% hasn''t ended yet, so it can''t be closed', to_char(v_next.period_end, 'FMMonth YYYY')
      using errcode = 'check_violation';
  end if;

  v_tb := app.period_figures(v_next.period_start, v_next.period_end) -> 'trial_balance';
  if (v_tb ->> 'debits')::numeric <> (v_tb ->> 'credits')::numeric then
    raise exception 'the books don''t balance (debits %, credits %); the month hasn''t been closed', v_tb ->> 'debits', v_tb ->> 'credits'
      using errcode = 'check_violation';
  end if;

  if extract(month from v_next.period_end) = 12 then
    v_year_start := make_date(extract(year from v_next.period_end)::integer, 1, 1);
    v_closing := app.close_year(v_next.period_end, auth.uid());
    insert into public.period_closes (period_kind, period_start, period_end, closed_by, note, report, closing_entry_ids)
    values ('year', v_year_start, v_next.period_end, auth.uid(), nullif(trim(coalesce(p_note, '')), ''),
            app.period_figures(v_year_start, v_next.period_end), v_closing);
  end if;

  insert into public.period_closes (period_kind, period_start, period_end, closed_by, note, report)
  values ('month', v_next.period_start, v_next.period_end, auth.uid(), nullif(trim(coalesce(p_note, '')), ''),
          app.period_figures(v_next.period_start, v_next.period_end)
            || jsonb_build_object('unfinished', app.unfinished_work(v_next.period_end)))
  returning * into v_close;
  return v_close;
end;
$$;
revoke all on function public.run_month_end(date, text) from public, anon;
grant execute on function public.run_month_end(date, text) to authenticated;
