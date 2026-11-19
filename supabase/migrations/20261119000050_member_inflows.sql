-- Not every payment that reaches Accounts for a member is a top up. The Accounts > Member top ups desk becomes
-- Member inflows: Accounts records any money that came in for a member and says what it is for.
--   * top_up_requests.inflow_type: 'contribution' (the member's regular payment on a plan) or 'top_up' (extra money
--     added to a plan). Rows already sent were all top ups, so they keep 'top_up'.
--   * initiate_top_up() takes the type. The branch officer can correct it when logging (log_top_up's p_inflow_type);
--     a regular contribution is logged as a 'scheduled' contribution, a top up as a 'top_up' one, so the top-up letter
--     and the "of which top-ups" totals only count real top ups.
--   * New inflows are numbered INF-000001 onwards (old ones keep their TOP- number), and the messages say "inflow".
-- The table and function names stay as they are, so nothing else has to change.

alter table public.top_up_requests
  add column if not exists inflow_type text not null default 'top_up' check (inflow_type in ('contribution', 'top_up'));

comment on column public.top_up_requests.inflow_type is
  'What the money is for: contribution (regular payment on the plan) or top_up (extra on the plan). Decides the contribution kind when logged.';

comment on table public.top_up_requests is
  'Member inflows: money Accounts received for a member and sent to the member''s branch to log against a plan.';

create or replace function app.top_up_requests_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'inflows are never deleted; cancel them instead' using errcode = 'insufficient_privilege';
  end if;
  if not app.in_workflow() then
    raise exception 'inflows change only through the member inflow workflow' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

-- Accounts records an inflow for a branch, or sends one the branch returned to a branch again. Gains p_inflow_type.
drop function if exists public.initiate_top_up(uuid, uuid, numeric, date, text, text, uuid, text, text, uuid, uuid);

create or replace function public.initiate_top_up(
  p_id uuid, p_branch_id uuid, p_amount numeric, p_paid_on date, p_payment_method text, p_reference text,
  p_bank_account_id uuid, p_paid_by text, p_note text, p_member_id uuid default null, p_member_plan_id uuid default null,
  p_inflow_type text default 'top_up'
)
returns public.top_up_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.top_up_requests;
  v_bank public.bank_accounts;
  v_member public.members;
  v_plan public.member_plans;
begin
  if p_id is not null then
    select * into v_row from public.top_up_requests where id = p_id for update;
    if not found or not app.has_branch_permission('accounts.receipts.record', v_row.branch_id) then
      raise exception 'inflow not found' using errcode = 'no_data_found';
    end if;
    if v_row.status <> 'returned' then
      raise exception 'only an inflow the branch sent back can be sent again' using errcode = 'check_violation';
    end if;
  end if;

  if p_inflow_type is null or p_inflow_type not in ('contribution', 'top_up') then
    raise exception 'say what the money is for: a regular contribution or a top up' using errcode = 'check_violation';
  end if;
  if p_branch_id is null or not app.has_branch_permission('accounts.receipts.record', p_branch_id) then
    raise exception 'choose a branch you record receipts for' using errcode = 'insufficient_privilege';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'enter the amount received' using errcode = 'check_violation';
  end if;
  if p_paid_on is null or p_paid_on > current_date then
    raise exception 'the date paid can''t be in the future' using errcode = 'check_violation';
  end if;
  if p_payment_method is null or p_payment_method not in ('bank_transfer', 'cash', 'pos', 'cheque') then
    raise exception 'choose how it was paid' using errcode = 'check_violation';
  end if;
  if p_paid_by is null or length(trim(p_paid_by)) < 2 then
    raise exception 'say who paid it, so the branch can find the member' using errcode = 'check_violation';
  end if;
  if p_bank_account_id is not null then
    select * into v_bank from public.bank_accounts where id = p_bank_account_id;
    if not found or v_bank.branch_id <> p_branch_id or not v_bank.is_active then
      raise exception 'the account it was paid into must be one of that branch''s active accounts' using errcode = 'check_violation';
    end if;
  end if;
  if p_member_plan_id is not null and p_member_id is null then
    raise exception 'choose the member before the plan' using errcode = 'check_violation';
  end if;
  if p_member_id is not null then
    select * into v_member from public.members where id = p_member_id;
    if not found or v_member.status <> 'approved' or not app.has_branch_permission('accounts.receipts.record', v_member.branch_id) then
      raise exception 'member not found' using errcode = 'no_data_found';
    end if;
    if v_member.branch_id <> p_branch_id then
      raise exception 'that member belongs to another branch: send it to the member''s branch' using errcode = 'check_violation';
    end if;
  end if;
  if p_member_plan_id is not null then
    select * into v_plan from public.member_plans where id = p_member_plan_id;
    if not found or v_plan.member_id <> p_member_id or v_plan.status <> 'active' then
      raise exception 'choose one of the member''s active plans' using errcode = 'check_violation';
    end if;
  end if;

  perform app.begin_workflow();
  if p_id is null then
    insert into public.top_up_requests (
      top_up_no, branch_id, amount, paid_on, payment_method, reference, bank_account_id, paid_by, note, status,
      requested_by, requested_at, matched_member_id, matched_plan_id, inflow_type
    ) values (
      'INF-' || lpad(nextval('public.top_up_no_seq')::text, 6, '0'), p_branch_id, p_amount, p_paid_on, p_payment_method,
      nullif(trim(coalesce(p_reference, '')), ''), p_bank_account_id, trim(p_paid_by), nullif(trim(coalesce(p_note, '')), ''),
      'with_branch', auth.uid(), now(), p_member_id, p_member_plan_id, p_inflow_type
    ) returning * into v_row;
  else
    update public.top_up_requests
       set branch_id = p_branch_id, amount = p_amount, paid_on = p_paid_on, payment_method = p_payment_method,
           reference = nullif(trim(coalesce(p_reference, '')), ''), bank_account_id = p_bank_account_id,
           paid_by = trim(p_paid_by), note = nullif(trim(coalesce(p_note, '')), ''), status = 'with_branch',
           requested_by = auth.uid(), requested_at = now(), matched_member_id = p_member_id, matched_plan_id = p_member_plan_id,
           inflow_type = p_inflow_type
     where id = p_id
     returning * into v_row;
  end if;
  perform app.end_workflow();
  return v_row;
end;
$$;

revoke all on function public.initiate_top_up(uuid, uuid, numeric, date, text, text, uuid, text, text, uuid, uuid, text) from public, anon;
grant execute on function public.initiate_top_up(uuid, uuid, numeric, date, text, text, uuid, text, text, uuid, uuid, text) to authenticated;

-- The branch logs the inflow against the member's plan. The officer may correct what it is for (p_inflow_type; null
-- keeps what Accounts said). A regular contribution becomes a 'scheduled' contribution, a top up a 'top_up' one.
drop function if exists public.log_top_up(uuid, uuid, text);

create or replace function public.log_top_up(p_id uuid, p_plan_id uuid, p_note text, p_inflow_type text default null)
returns public.top_up_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.top_up_requests;
  v_plan public.member_plans;
  v_type text;
  v_contribution_id uuid;
begin
  select * into v_row from public.top_up_requests where id = p_id for update;
  if not found or not app.has_branch_permission('contributions.record', v_row.branch_id) then
    raise exception 'inflow not found' using errcode = 'no_data_found';
  end if;
  if v_row.status <> 'with_branch' then
    raise exception 'this inflow isn''t waiting for the branch any more' using errcode = 'check_violation';
  end if;
  if v_row.requested_by = auth.uid() then
    raise exception 'you sent this inflow, so someone in the branch must log it' using errcode = 'insufficient_privilege';
  end if;
  v_type := coalesce(nullif(trim(coalesce(p_inflow_type, '')), ''), v_row.inflow_type);
  if v_type not in ('contribution', 'top_up') then
    raise exception 'say what the money is for: a regular contribution or a top up' using errcode = 'check_violation';
  end if;

  select * into v_plan from public.member_plans where id = p_plan_id;
  if not found or v_plan.branch_id <> v_row.branch_id then
    raise exception 'choose a savings plan in this branch' using errcode = 'check_violation';
  end if;
  if v_plan.status <> 'active' then
    raise exception 'money can only be logged on an active plan' using errcode = 'check_violation';
  end if;

  perform app.begin_workflow();
  insert into public.contributions (member_plan_id, member_id, branch_id, kind, amount, paid_on, payment_method, reference, notes)
  values (
    v_plan.id, v_plan.member_id, v_plan.branch_id,
    (case v_type when 'top_up' then 'top_up' else 'scheduled' end)::public.contribution_kind,
    v_row.amount, v_row.paid_on, v_row.payment_method, v_row.reference,
    concat_ws(' · ', 'Inflow ' || v_row.top_up_no || ' from Accounts', nullif(trim(coalesce(p_note, '')), ''))
  ) returning id into v_contribution_id;

  update public.top_up_requests
     set status = 'logged', member_id = v_plan.member_id, member_plan_id = v_plan.id, contribution_id = v_contribution_id,
         logged_by = auth.uid(), logged_at = now(), inflow_type = v_type
   where id = p_id
   returning * into v_row;
  perform app.end_workflow();
  return v_row;
end;
$$;

revoke all on function public.log_top_up(uuid, uuid, text, text) from public, anon;
grant execute on function public.log_top_up(uuid, uuid, text, text) to authenticated;

-- Same as before; only the messages now say "inflow".
create or replace function public.return_top_up(p_id uuid, p_reason text)
returns public.top_up_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.top_up_requests;
begin
  select * into v_row from public.top_up_requests where id = p_id for update;
  if not found or not app.has_branch_permission('contributions.record', v_row.branch_id) then
    raise exception 'inflow not found' using errcode = 'no_data_found';
  end if;
  if v_row.status <> 'with_branch' then
    raise exception 'this inflow isn''t waiting for the branch any more' using errcode = 'check_violation';
  end if;
  if p_reason is null or length(trim(p_reason)) < 3 then
    raise exception 'say why it''s going back to Accounts' using errcode = 'check_violation';
  end if;

  perform app.begin_workflow();
  update public.top_up_requests
     set status = 'returned', decided_by = auth.uid(), decided_at = now(), decision_note = trim(p_reason)
   where id = p_id
   returning * into v_row;
  perform app.end_workflow();
  return v_row;
end;
$$;

create or replace function public.cancel_top_up(p_id uuid, p_reason text)
returns public.top_up_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.top_up_requests;
begin
  select * into v_row from public.top_up_requests where id = p_id for update;
  if not found or not app.has_branch_permission('accounts.receipts.record', v_row.branch_id) then
    raise exception 'inflow not found' using errcode = 'no_data_found';
  end if;
  if v_row.status not in ('with_branch', 'returned') then
    raise exception 'only an inflow the branch hasn''t logged can be cancelled' using errcode = 'check_violation';
  end if;
  if p_reason is null or length(trim(p_reason)) < 3 then
    raise exception 'say why it''s being cancelled' using errcode = 'check_violation';
  end if;

  perform app.begin_workflow();
  update public.top_up_requests
     set status = 'cancelled', decided_by = auth.uid(), decided_at = now(), decision_note = trim(p_reason)
   where id = p_id
   returning * into v_row;
  perform app.end_workflow();
  return v_row;
end;
$$;

-- top_up_list also returns what each inflow is for.
drop function if exists public.top_up_list(text[]);

create or replace function public.top_up_list(p_statuses text[] default null)
returns table (
  id uuid, top_up_no text, branch_id uuid, branch_name text, amount numeric, paid_on date, payment_method text,
  reference text, bank_account_id uuid, bank_account_name text, paid_by text, note text, status text,
  requested_by uuid, requested_by_name text, requested_at timestamptz,
  member_id uuid, member_name text, membership_no text, member_plan_id uuid, plan_name text, contribution_id uuid,
  contribution_verified boolean, contribution_status text, logged_by_name text, logged_at timestamptz,
  decided_by_name text, decided_at timestamptz, decision_note text,
  matched_member_id uuid, matched_member_name text, matched_membership_no text, matched_plan_id uuid, matched_plan_name text,
  inflow_type text
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.top_up_no, r.branch_id, br.name, r.amount, r.paid_on, r.payment_method,
         r.reference, r.bank_account_id, b.name, r.paid_by, r.note, r.status,
         r.requested_by, rs.full_name, r.requested_at,
         r.member_id, concat_ws(' ', m.first_name, m.middle_name, m.last_name), m.membership_no, r.member_plan_id, pt.name,
         r.contribution_id, c.verified_at is not null,
         (select t.status::text from public.finance_transactions t
           where t.contribution_id = r.contribution_id and t.status <> 'rejected' limit 1),
         ls.full_name, r.logged_at,
         ds.full_name, r.decided_at, r.decision_note,
         r.matched_member_id, concat_ws(' ', mm.first_name, mm.middle_name, mm.last_name), mm.membership_no,
         r.matched_plan_id, mpt.name,
         r.inflow_type
  from public.top_up_requests r
  join public.branches br on br.id = r.branch_id
  join public.staff rs on rs.id = r.requested_by
  left join public.bank_accounts b on b.id = r.bank_account_id
  left join public.members m on m.id = r.member_id
  left join public.member_plans p on p.id = r.member_plan_id
  left join public.plan_types pt on pt.code = p.plan_type
  left join public.contributions c on c.id = r.contribution_id
  left join public.staff ls on ls.id = r.logged_by
  left join public.staff ds on ds.id = r.decided_by
  left join public.members mm on mm.id = r.matched_member_id
  left join public.member_plans mp on mp.id = r.matched_plan_id
  left join public.plan_types mpt on mpt.code = mp.plan_type
  where (p_statuses is null or r.status = any (p_statuses))
    and (
      app.has_branch_permission('accounts.read', r.branch_id)
      or app.has_branch_permission('members.read', r.branch_id)
    )
  order by r.requested_at desc
  limit 500;
$$;

revoke all on function public.top_up_list(text[]) from public, anon;
grant execute on function public.top_up_list(text[]) to authenticated;

update public.permissions set description = 'Record contributions and reversals, and log member inflows Accounts sends'
 where code = 'contributions.record';
