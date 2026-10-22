-- Human Resources, part 5: sales commission and whistleblowing.
--
-- Commission
--   target (employee, period, amount, how commission is worked out) ◀── sales recorded against it
--   each sale: pending ──approve──▶ approved   (or rejected)
--   after the period: close the target ──▶ commission payout ──▶ paid with the next payroll
--
--   * The commission rate comes from the target, never from the person recording the sale.
--   * Nobody approves their own sale, a sale they recorded, or closes their own target.
--   * Commission is paid only through payroll, so it is taxed and posted once.
--
-- Whistleblowing ("speak up")
--   * Any staff member can report a concern, named or anonymous. An anonymous report stores nothing about who sent
--     it: no staff id and no audit trail entry. The reporter gets a reference and a one-time access code to follow
--     the case and exchange messages with the investigators.
--   * Only Internal Audit (whistleblowing.manage) sees reports, so nobody in the reporter's line of management can.

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------

insert into public.permissions (code, description) values
  ('commission.manage', 'Set commission targets and record sales for staff'),
  ('commission.approve', 'Approve recorded sales and close commission targets'),
  ('whistleblowing.manage', 'Read and investigate whistleblowing reports');

insert into public.role_permissions (role_code, permission_code) values
  ('hr_officer', 'commission.manage'),
  ('head_of_hr', 'commission.manage'),
  ('head_of_hr', 'commission.approve'),
  ('payroll_officer', 'commission.manage'),
  ('financial_controller', 'commission.approve'),
  ('internal_auditor', 'whistleblowing.manage');

-- ---------------------------------------------------------------------------
-- Commission targets and sales
-- ---------------------------------------------------------------------------

create table public.commission_targets (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees (id) on delete restrict,
  name text not null check (length(trim(name)) > 0),
  period_start date not null,
  period_end date not null,
  target_amount numeric(14, 2) not null check (target_amount > 0),
  -- percent_of_sales: rate% of every approved sale. percent_of_target_if_met: rate% of the target once it is met.
  -- flat_if_met: flat_amount once met. tiered: progressive rates on sales, like tax bands.
  method text not null check (method in ('percent_of_sales', 'percent_of_target_if_met', 'flat_if_met', 'tiered')),
  rate numeric(6, 3) check (rate between 0 and 100),
  flat_amount numeric(14, 2) check (flat_amount > 0),
  -- For tiered: [{"upto": 1000000, "rate": 2}, {"upto": null, "rate": 4}].
  tiers jsonb,
  status text not null default 'open' check (status in ('open', 'closed', 'cancelled')),
  achieved numeric(14, 2),
  commission numeric(14, 2),
  payout_id uuid references public.commission_payouts (id),
  created_by uuid not null default auth.uid() references public.staff (id),
  created_at timestamptz not null default now(),
  closed_by uuid references public.staff (id),
  closed_at timestamptz,
  constraint commission_targets_period check (period_end >= period_start),
  constraint commission_targets_terms check (
    (method in ('percent_of_sales', 'percent_of_target_if_met') and rate is not null)
    or (method = 'flat_if_met' and flat_amount is not null)
    or (method = 'tiered' and tiers is not null and jsonb_typeof(tiers) = 'array' and jsonb_array_length(tiers) > 0)
  )
);
create index commission_targets_employee_idx on public.commission_targets (employee_id, period_end);

create table public.commission_sales (
  id uuid primary key default gen_random_uuid(),
  target_id uuid not null references public.commission_targets (id) on delete restrict,
  employee_id uuid not null references public.employees (id),
  client_name text not null check (length(trim(client_name)) > 0),
  description text,
  amount numeric(14, 2) not null check (amount > 0),
  sale_date date not null,
  reference text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decision_note text,
  recorded_by uuid not null default auth.uid() references public.staff (id),
  recorded_at timestamptz not null default now(),
  decided_by uuid references public.staff (id),
  decided_at timestamptz
);
create index commission_sales_target_idx on public.commission_sales (target_id, status);

create or replace function app.commission_targets_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if app.in_workflow() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if app.is_own_employee_record(new.employee_id) then
      raise exception 'someone else sets your commission targets' using errcode = 'insufficient_privilege';
    end if;
    new.status := 'open';
    new.achieved := null;
    new.commission := null;
    new.payout_id := null;
    new.created_by := auth.uid();
    new.created_at := now();
    new.closed_by := null;
    new.closed_at := null;
    return new;
  end if;
  if old.status <> 'open' then
    raise exception 'this target is closed' using errcode = 'check_violation';
  end if;
  if new.status not in ('open', 'cancelled') or new.achieved is distinct from old.achieved
     or new.commission is distinct from old.commission or new.payout_id is distinct from old.payout_id
     or new.employee_id is distinct from old.employee_id or new.created_by is distinct from old.created_by then
    raise exception 'targets are closed with the close button' using errcode = 'insufficient_privilege';
  end if;
  if new.status = 'open' and exists (select 1 from public.commission_sales s where s.target_id = new.id and s.status = 'approved')
     and (new.method is distinct from old.method or new.rate is distinct from old.rate
          or new.flat_amount is distinct from old.flat_amount or new.tiers is distinct from old.tiers
          or new.target_amount is distinct from old.target_amount) then
    raise exception 'sales have been approved against this target, so its terms are fixed' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger commission_targets_guard
  before insert or update on public.commission_targets
  for each row execute function app.commission_targets_guard();

create or replace function app.commission_sales_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target public.commission_targets;
begin
  if app.in_workflow() then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    if old.status <> 'pending' or old.recorded_by <> auth.uid() then
      raise exception 'only a pending sale you recorded can be removed' using errcode = 'insufficient_privilege';
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' then
    raise exception 'sales are approved or rejected with the buttons; remove a pending sale and record it again'
      using errcode = 'insufficient_privilege';
  end if;
  select * into v_target from public.commission_targets where id = new.target_id;
  if v_target.status <> 'open' then
    raise exception 'that target is closed' using errcode = 'check_violation';
  end if;
  if new.sale_date not between v_target.period_start and v_target.period_end then
    raise exception 'the sale date must fall within the target''s period' using errcode = 'check_violation';
  end if;
  if new.sale_date > current_date then
    raise exception 'the sale date can''t be in the future' using errcode = 'check_violation';
  end if;
  new.employee_id := v_target.employee_id;
  new.status := 'pending';
  new.decision_note := null;
  new.recorded_by := auth.uid();
  new.recorded_at := now();
  new.decided_by := null;
  new.decided_at := null;
  return new;
end;
$$;

create trigger commission_sales_guard
  before insert or update or delete on public.commission_sales
  for each row execute function app.commission_sales_guard();

create or replace function public.decide_commission_sale(p_sale_id uuid, p_approve boolean, p_note text default null)
returns public.commission_sales
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sale public.commission_sales;
begin
  select * into v_sale from public.commission_sales where id = p_sale_id for update;
  if not found or not app.has_branch_permission('commission.approve', app.employee_branch(v_sale.employee_id)) then
    raise exception 'sale not found' using errcode = 'no_data_found';
  end if;
  if v_sale.status <> 'pending' then
    raise exception 'this sale has already been decided' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.commission_targets t where t.id = v_sale.target_id and t.status = 'open') then
    raise exception 'this target has been cancelled' using errcode = 'check_violation';
  end if;
  if v_sale.recorded_by = auth.uid() or app.is_own_employee_record(v_sale.employee_id) then
    raise exception 'someone else has to approve this sale' using errcode = 'insufficient_privilege';
  end if;
  if not p_approve and (p_note is null or length(trim(p_note)) < 3) then
    raise exception 'say why you are rejecting it' using errcode = 'check_violation';
  end if;
  perform app.begin_workflow();
  update public.commission_sales
     set status = case when p_approve then 'approved' else 'rejected' end, decision_note = nullif(trim(p_note), ''),
         decided_by = auth.uid(), decided_at = now()
   where id = p_sale_id returning * into v_sale;
  perform app.end_workflow();
  return v_sale;
end;
$$;

-- Commission earned on a target from its approved sales.
create or replace function app.commission_for(p_target public.commission_targets, p_achieved numeric)
returns numeric
language sql
immutable
as $$
  select round(case p_target.method
    when 'percent_of_sales' then p_achieved * p_target.rate / 100
    when 'percent_of_target_if_met' then case when p_achieved >= p_target.target_amount then p_target.target_amount * p_target.rate / 100 else 0 end
    when 'flat_if_met' then case when p_achieved >= p_target.target_amount then p_target.flat_amount else 0 end
    else app.paye_annual(p_achieved, p_target.tiers)
  end, 2);
$$;

-- Closes a target after its period: totals approved sales, works out the commission and queues it for payroll.
create or replace function public.close_commission_target(p_target_id uuid)
returns public.commission_targets
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target public.commission_targets;
  v_achieved numeric;
  v_commission numeric;
  v_payout uuid;
begin
  select * into v_target from public.commission_targets where id = p_target_id for update;
  if not found or not app.has_branch_permission('commission.approve', app.employee_branch(v_target.employee_id)) then
    raise exception 'target not found' using errcode = 'no_data_found';
  end if;
  if app.is_own_employee_record(v_target.employee_id) then
    raise exception 'someone else has to close your own target' using errcode = 'insufficient_privilege';
  end if;
  if v_target.status <> 'open' then
    raise exception 'this target is already closed' using errcode = 'check_violation';
  end if;
  if v_target.period_end >= current_date then
    raise exception 'close the target once its period has ended' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.commission_sales where target_id = p_target_id and status = 'pending') then
    raise exception 'approve or reject the pending sales first' using errcode = 'check_violation';
  end if;

  select coalesce(sum(amount), 0) into v_achieved from public.commission_sales where target_id = p_target_id and status = 'approved';
  v_commission := app.commission_for(v_target, v_achieved);

  perform app.begin_workflow();
  if v_commission > 0 then
    insert into public.commission_payouts (employee_id, description, amount, payable_from, approved_by)
    values (v_target.employee_id, 'Commission: ' || v_target.name, v_commission, v_target.period_end, auth.uid())
    returning id into v_payout;
  end if;
  update public.commission_targets
     set status = 'closed', achieved = v_achieved, commission = v_commission, payout_id = v_payout,
         closed_by = auth.uid(), closed_at = now()
   where id = p_target_id
   returning * into v_target;
  perform app.end_workflow();
  return v_target;
end;
$$;

select app.enable_audit('public.commission_targets');
select app.enable_audit('public.commission_sales');

alter table public.commission_targets enable row level security;
alter table public.commission_sales enable row level security;

create policy "HR, approvers and the employee see targets" on public.commission_targets for select to authenticated
  using (app.has_branch_permission('commission.manage', app.employee_branch(employee_id))
         or app.has_branch_permission('commission.approve', app.employee_branch(employee_id))
         or app.has_permission('payroll.read')
         or app.is_own_employee_record(employee_id));
create policy "commission managers set targets" on public.commission_targets for insert to authenticated
  with check (app.has_branch_permission('commission.manage', app.employee_branch(employee_id)));
create policy "commission managers change targets" on public.commission_targets for update to authenticated
  using (app.has_branch_permission('commission.manage', app.employee_branch(employee_id)))
  with check (app.has_branch_permission('commission.manage', app.employee_branch(employee_id)));

create policy "people who see the target see its sales" on public.commission_sales for select to authenticated
  using (exists (select 1 from public.commission_targets t where t.id = target_id));
create policy "employees and commission managers record sales" on public.commission_sales for insert to authenticated
  with check (
    exists (
      select 1 from public.commission_targets t
      where t.id = target_id
        and (app.is_own_employee_record(t.employee_id)
             or app.has_branch_permission('commission.manage', app.employee_branch(t.employee_id)))
    )
  );
create policy "recorders remove pending sales" on public.commission_sales for delete to authenticated
  using (recorded_by = auth.uid() and status = 'pending');

-- Commission approvers (the Financial Controller) and payroll readers don't read HR files (hr.read), but they need
-- to know whose sales they approve and whose pay they check. This gives them names, employee numbers and branches
-- for the people they deal with, and nothing else from the record.
create or replace function public.pay_people(p_employee_ids uuid[])
returns table (id uuid, full_name text, employee_no text, branch_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select e.id, e.first_name || ' ' || e.last_name, e.employee_no, e.branch_id
  from public.employees e
  where e.id = any (p_employee_ids)
    and (
      app.has_branch_permission('hr.read', e.branch_id)
      or ((app.has_permission('payroll.read') or app.has_permission('payroll.salaries.approve'))
          and (exists (select 1 from public.employee_salaries s where s.employee_id = e.id)
               or exists (select 1 from public.payroll_lines l where l.employee_id = e.id)))
      or e.staff_id = auth.uid()
      or (exists (select 1 from public.commission_targets t where t.employee_id = e.id)
          and (app.has_branch_permission('commission.manage', e.branch_id)
               or app.has_branch_permission('commission.approve', e.branch_id)))
    );
$$;

-- ---------------------------------------------------------------------------
-- Whistleblowing
-- ---------------------------------------------------------------------------

create table public.whistleblowing_reports (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  access_code_hash text not null,
  category text not null check (category in (
    'fraud', 'corruption', 'harassment', 'discrimination', 'safety', 'theft', 'misconduct', 'other'
  )),
  title text not null check (length(trim(title)) between 5 and 200),
  description text not null check (length(trim(description)) >= 20),
  incident_date date,
  location text,
  people_involved text,
  is_anonymous boolean not null,
  -- Null for anonymous reports: nothing ties them to a login.
  reporter_staff_id uuid references public.staff (id),
  status text not null default 'received' check (status in ('received', 'investigating', 'resolved', 'dismissed')),
  assigned_to uuid references public.staff (id),
  findings text,
  outcome text,
  -- Only the day, so an anonymous report can't be matched to sign-in times.
  received_on date not null default current_date,
  closed_on date,
  constraint whistleblowing_anonymous check (not is_anonymous or reporter_staff_id is null)
);
create index whistleblowing_reports_status_idx on public.whistleblowing_reports (status);

create table public.whistleblowing_messages (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.whistleblowing_reports (id) on delete restrict,
  from_reporter boolean not null,
  -- The investigator who wrote it; null for messages from the reporter.
  author_id uuid references public.staff (id),
  body text not null check (length(trim(body)) > 0),
  sent_on date not null default current_date,
  -- Orders the conversation without recording the time of day.
  seq bigint generated always as identity,
  constraint whistleblowing_messages_author check (from_reporter = (author_id is null))
);
create index whistleblowing_messages_report_idx on public.whistleblowing_messages (report_id);

-- Inserts come only through the functions below, and aren't audited (the audit trail records the login).
-- Investigators' later changes are audited as usual.
create trigger audit_log_changes after update or delete on public.whistleblowing_reports
  for each row execute function app.log_change();

create or replace function app.whistleblowing_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if app.in_workflow() then
    return coalesce(new, old);
  end if;
  if tg_op = 'INSERT' and tg_table_name = 'whistleblowing_messages' then
    if new.from_reporter then
      raise exception 'reporters reply through their case reference' using errcode = 'insufficient_privilege';
    end if;
    new.author_id := auth.uid();
    new.sent_on := current_date;
    return new;
  end if;
  if tg_op = 'INSERT' or tg_op = 'DELETE' then
    raise exception 'reports are made through the speak-up form and never deleted' using errcode = 'insufficient_privilege';
  end if;
  if tg_table_name = 'whistleblowing_reports' then
    if new.reference is distinct from old.reference or new.access_code_hash is distinct from old.access_code_hash
       or new.category is distinct from old.category or new.title is distinct from old.title
       or new.description is distinct from old.description or new.is_anonymous is distinct from old.is_anonymous
       or new.reporter_staff_id is distinct from old.reporter_staff_id or new.received_on is distinct from old.received_on then
      raise exception 'what the reporter wrote can''t be changed' using errcode = 'insufficient_privilege';
    end if;
    new.closed_on := case when new.status in ('resolved', 'dismissed') then coalesce(old.closed_on, current_date) end;
    if new.status in ('resolved', 'dismissed') and (new.outcome is null or length(trim(new.outcome)) < 5) then
      raise exception 'record the outcome before closing the case' using errcode = 'check_violation';
    end if;
    return new;
  end if;
  raise exception 'messages can''t be changed' using errcode = 'insufficient_privilege';
end;
$$;

create trigger whistleblowing_reports_guard before insert or update or delete on public.whistleblowing_reports
  for each row execute function app.whistleblowing_guard();
create trigger whistleblowing_messages_guard before insert or update or delete on public.whistleblowing_messages
  for each row execute function app.whistleblowing_guard();

alter table public.whistleblowing_reports enable row level security;
alter table public.whistleblowing_messages enable row level security;

create policy "investigators see reports" on public.whistleblowing_reports for select to authenticated
  using (app.has_permission('whistleblowing.manage'));
create policy "investigators work on reports" on public.whistleblowing_reports for update to authenticated
  using (app.has_permission('whistleblowing.manage')) with check (app.has_permission('whistleblowing.manage'));
create policy "investigators see messages" on public.whistleblowing_messages for select to authenticated
  using (app.has_permission('whistleblowing.manage'));
create policy "investigators write to reporters" on public.whistleblowing_messages for insert to authenticated
  with check (app.has_permission('whistleblowing.manage') and not from_reporter);

create or replace function app.access_code_hash(p_code text)
returns text
language sql
immutable
as $$
  select encode(sha256(convert_to('silverkuun-speak-up:' || upper(trim(p_code)), 'UTF8')), 'hex');
$$;

-- Makes a report. Returns the reference and an access code shown to the reporter once.
create or replace function public.submit_whistleblowing_report(
  p_category text,
  p_title text,
  p_description text,
  p_incident_date date,
  p_location text,
  p_people_involved text,
  p_anonymous boolean
)
returns table (reference text, access_code text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reference text;
  v_code text := upper(substr(encode(sha256(convert_to(gen_random_uuid()::text || clock_timestamp()::text, 'UTF8')), 'hex'), 1, 12));
begin
  if not exists (select 1 from public.staff where id = auth.uid() and is_active) then
    raise exception 'sign in to make a report' using errcode = 'insufficient_privilege';
  end if;
  loop
    v_reference := 'SU-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    exit when not exists (select 1 from public.whistleblowing_reports r where r.reference = v_reference);
  end loop;

  perform app.begin_workflow();
  insert into public.whistleblowing_reports
    (reference, access_code_hash, category, title, description, incident_date, location, people_involved, is_anonymous, reporter_staff_id)
  values
    (v_reference, app.access_code_hash(v_code), p_category, trim(p_title), trim(p_description), p_incident_date,
     nullif(trim(p_location), ''), nullif(trim(p_people_involved), ''), p_anonymous,
     case when p_anonymous then null else auth.uid() end);
  perform app.end_workflow();

  return query select v_reference, substr(v_code, 1, 4) || '-' || substr(v_code, 5, 4) || '-' || substr(v_code, 9, 4);
end;
$$;

-- What the reporter can see about their case, given the reference and access code.
create or replace function public.whistleblowing_case(p_reference text, p_access_code text)
returns table (reference text, title text, status text, received_on date, closed_on date, outcome text, messages jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  select r.reference, r.title, r.status, r.received_on, r.closed_on,
         case when r.status in ('resolved', 'dismissed') then r.outcome end,
         coalesce((select jsonb_agg(jsonb_build_object('from_reporter', m.from_reporter, 'body', m.body, 'sent_on', m.sent_on)
                                    order by m.seq)
                   from public.whistleblowing_messages m where m.report_id = r.id), '[]'::jsonb)
  from public.whistleblowing_reports r
  where r.reference = upper(trim(p_reference))
    and r.access_code_hash = app.access_code_hash(replace(p_access_code, '-', ''))
    and exists (select 1 from public.staff s where s.id = auth.uid() and s.is_active);
$$;

create or replace function public.whistleblowing_reply(p_reference text, p_access_code text, p_body text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_report_id uuid;
begin
  select r.id into v_report_id from public.whistleblowing_reports r
  where r.reference = upper(trim(p_reference)) and r.access_code_hash = app.access_code_hash(replace(p_access_code, '-', ''));
  if v_report_id is null then
    raise exception 'that reference and code don''t match a report' using errcode = 'no_data_found';
  end if;
  if p_body is null or length(trim(p_body)) = 0 then
    raise exception 'write a message' using errcode = 'check_violation';
  end if;
  perform app.begin_workflow();
  insert into public.whistleblowing_messages (report_id, from_reporter, body) values (v_report_id, true, trim(p_body));
  perform app.end_workflow();
end;
$$;

-- ---------------------------------------------------------------------------
-- Function grants
-- ---------------------------------------------------------------------------

revoke all on function public.decide_commission_sale(uuid, boolean, text) from public, anon;
revoke all on function public.close_commission_target(uuid) from public, anon;
revoke all on function public.submit_whistleblowing_report(text, text, text, date, text, text, boolean) from public, anon;
revoke all on function public.whistleblowing_case(text, text) from public, anon;
revoke all on function public.whistleblowing_reply(text, text, text) from public, anon;
revoke all on function public.pay_people(uuid[]) from public, anon;

grant execute on function public.decide_commission_sale(uuid, boolean, text) to authenticated;
grant execute on function public.close_commission_target(uuid) to authenticated;
grant execute on function public.submit_whistleblowing_report(text, text, text, date, text, text, boolean) to authenticated;
grant execute on function public.whistleblowing_case(text, text) to authenticated;
grant execute on function public.whistleblowing_reply(text, text, text) to authenticated;
grant execute on function public.pay_people(uuid[]) to authenticated;
