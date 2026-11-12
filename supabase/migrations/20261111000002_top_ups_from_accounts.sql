-- Member top ups now start in Accounts.
--   1. Accounts sees the money arrive, records the top up (amount, date, how it was paid, reference, who paid it) and
--      chooses the branch it belongs to.
--   2. That branch's Operations officer finds the member and plan and logs it. Logging creates the member's top-up
--      contribution with exactly the amount, date and reference Accounts gave, so the officer can't change them.
--   3. From there it follows the usual contribution path: the Branch Manager verifies it and Accounts posts it.
-- If the branch can't match it to a member, the officer sends it back with the reason, and Accounts sends it to another
-- branch or cancels it. Operations can no longer record a top-up on its own.

create sequence if not exists public.top_up_no_seq;

create table public.top_up_requests (
  id uuid primary key default gen_random_uuid(),
  top_up_no text not null unique,
  branch_id uuid not null references public.branches (id),
  amount numeric(14, 2) not null check (amount > 0),
  paid_on date not null,
  payment_method text not null check (payment_method in ('bank_transfer', 'cash', 'pos', 'cheque')),
  reference text,
  -- The account the money went into, if Accounts knows it. Always one of the branch's accounts.
  bank_account_id uuid references public.bank_accounts (id),
  -- Who the money came from (the member's name, or the name on the transfer), for the branch to find the member.
  paid_by text not null check (length(trim(paid_by)) > 1),
  note text,
  status text not null default 'with_branch' check (status in ('with_branch', 'logged', 'returned', 'cancelled')),
  requested_by uuid not null references public.staff (id),
  requested_at timestamptz not null default now(),
  -- Filled in when the branch logs it.
  member_id uuid references public.members (id),
  member_plan_id uuid references public.member_plans (id),
  contribution_id uuid unique references public.contributions (id),
  logged_by uuid references public.staff (id),
  logged_at timestamptz,
  -- Filled in when the branch sends it back, or Accounts cancels it.
  decided_by uuid references public.staff (id),
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now(),
  constraint top_up_requests_logged check ((status = 'logged') = (contribution_id is not null))
);
create index top_up_requests_branch_status_idx on public.top_up_requests (branch_id, status);

-- Rows change only through the functions below.
create or replace function app.top_up_requests_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'top ups are never deleted; cancel them instead' using errcode = 'insufficient_privilege';
  end if;
  if not app.in_workflow() then
    raise exception 'top ups change only through the top up workflow' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger top_up_requests_guard
  before insert or update or delete on public.top_up_requests
  for each row execute function app.top_up_requests_guard();

select app.enable_audit('public.top_up_requests');

alter table public.top_up_requests enable row level security;
create policy "accounts and the branch read top ups" on public.top_up_requests for select to authenticated
  using (
    app.has_branch_permission('accounts.read', branch_id)
    or app.has_branch_permission('members.read', branch_id)
  );

-- A top-up contribution can only be created by logging a top up Accounts sent. Everything else is unchanged.
create or replace function app.contributions_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan public.member_plans;
  v_original public.contributions;
begin
  if tg_op = 'DELETE' then
    raise exception 'contributions are never deleted; record a reversal instead' using errcode = 'insufficient_privilege';
  end if;

  if tg_op = 'UPDATE' then
    if not app.in_workflow() then
      raise exception 'contributions are never edited; record a reversal instead' using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;

  if new.kind = 'top_up' and not app.in_workflow() then
    raise exception 'top ups come from Accounts: log the top up Accounts sent to your branch' using errcode = 'insufficient_privilege';
  end if;

  if new.paid_on > current_date then
    raise exception 'payment date can''t be in the future' using errcode = 'check_violation';
  end if;

  select * into v_plan from public.member_plans where id = new.member_plan_id;
  if v_plan.status <> 'active' then
    raise exception 'contributions can only be recorded on active plans' using errcode = 'check_violation';
  end if;

  new.member_id := v_plan.member_id;
  new.branch_id := v_plan.branch_id;
  new.recorded_by := auth.uid();
  new.recorded_at := now();
  new.verified_by := null;
  new.verified_at := null;

  if new.kind = 'reversal' then
    select * into v_original from public.contributions where id = new.reverses_id;
    if v_original.member_plan_id is distinct from new.member_plan_id then
      raise exception 'a reversal must be on the same plan as the entry it reverses' using errcode = 'check_violation';
    end if;
    if v_original.kind = 'reversal' then
      raise exception 'a reversal can''t itself be reversed' using errcode = 'check_violation';
    end if;
    if new.amount <> -v_original.amount then
      raise exception 'a reversal must be for exactly the original amount' using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

-- Accounts records a top up for a branch, or sends one the branch returned to a branch again (the same or another).
create or replace function public.initiate_top_up(
  p_id uuid, p_branch_id uuid, p_amount numeric, p_paid_on date, p_payment_method text, p_reference text,
  p_bank_account_id uuid, p_paid_by text, p_note text
)
returns public.top_up_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.top_up_requests;
  v_bank public.bank_accounts;
begin
  if p_id is not null then
    select * into v_row from public.top_up_requests where id = p_id for update;
    if not found or not app.has_branch_permission('accounts.receipts.record', v_row.branch_id) then
      raise exception 'top up not found' using errcode = 'no_data_found';
    end if;
    if v_row.status <> 'returned' then
      raise exception 'only a top up the branch sent back can be sent again' using errcode = 'check_violation';
    end if;
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

  perform app.begin_workflow();
  if p_id is null then
    insert into public.top_up_requests (
      top_up_no, branch_id, amount, paid_on, payment_method, reference, bank_account_id, paid_by, note, status,
      requested_by, requested_at
    ) values (
      'TOP-' || lpad(nextval('public.top_up_no_seq')::text, 6, '0'), p_branch_id, p_amount, p_paid_on, p_payment_method,
      nullif(trim(coalesce(p_reference, '')), ''), p_bank_account_id, trim(p_paid_by), nullif(trim(coalesce(p_note, '')), ''),
      'with_branch', auth.uid(), now()
    ) returning * into v_row;
  else
    update public.top_up_requests
       set branch_id = p_branch_id, amount = p_amount, paid_on = p_paid_on, payment_method = p_payment_method,
           reference = nullif(trim(coalesce(p_reference, '')), ''), bank_account_id = p_bank_account_id,
           paid_by = trim(p_paid_by), note = nullif(trim(coalesce(p_note, '')), ''), status = 'with_branch',
           requested_by = auth.uid(), requested_at = now()
     where id = p_id
     returning * into v_row;
  end if;
  perform app.end_workflow();
  return v_row;
end;
$$;

-- The branch logs the top up against the member's plan. Amount, date, method and reference are Accounts'.
create or replace function public.log_top_up(p_id uuid, p_plan_id uuid, p_note text)
returns public.top_up_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.top_up_requests;
  v_plan public.member_plans;
  v_contribution_id uuid;
begin
  select * into v_row from public.top_up_requests where id = p_id for update;
  if not found or not app.has_branch_permission('contributions.record', v_row.branch_id) then
    raise exception 'top up not found' using errcode = 'no_data_found';
  end if;
  if v_row.status <> 'with_branch' then
    raise exception 'this top up isn''t waiting for the branch any more' using errcode = 'check_violation';
  end if;
  if v_row.requested_by = auth.uid() then
    raise exception 'you sent this top up, so someone in the branch must log it' using errcode = 'insufficient_privilege';
  end if;

  select * into v_plan from public.member_plans where id = p_plan_id;
  if not found or v_plan.branch_id <> v_row.branch_id then
    raise exception 'choose a savings plan in this branch' using errcode = 'check_violation';
  end if;
  if v_plan.status <> 'active' then
    raise exception 'top ups can only go on an active plan' using errcode = 'check_violation';
  end if;

  perform app.begin_workflow();
  insert into public.contributions (member_plan_id, member_id, branch_id, kind, amount, paid_on, payment_method, reference, notes)
  values (
    v_plan.id, v_plan.member_id, v_plan.branch_id, 'top_up', v_row.amount, v_row.paid_on, v_row.payment_method, v_row.reference,
    concat_ws(' · ', 'Top up ' || v_row.top_up_no || ' from Accounts', nullif(trim(coalesce(p_note, '')), ''))
  ) returning id into v_contribution_id;

  update public.top_up_requests
     set status = 'logged', member_id = v_plan.member_id, member_plan_id = v_plan.id, contribution_id = v_contribution_id,
         logged_by = auth.uid(), logged_at = now()
   where id = p_id
   returning * into v_row;
  perform app.end_workflow();
  return v_row;
end;
$$;

-- The branch can't match the top up to one of its members: it goes back to Accounts with the reason.
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
    raise exception 'top up not found' using errcode = 'no_data_found';
  end if;
  if v_row.status <> 'with_branch' then
    raise exception 'this top up isn''t waiting for the branch any more' using errcode = 'check_violation';
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

-- Accounts withdraws a top up the branch hasn't logged (sent in error, or the money was refunded).
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
    raise exception 'top up not found' using errcode = 'no_data_found';
  end if;
  if v_row.status not in ('with_branch', 'returned') then
    raise exception 'only a top up the branch hasn''t logged can be cancelled' using errcode = 'check_violation';
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

-- Top ups with the names both sides need. Operations can't read Accounts' bank accounts, and neither side reads the
-- other's staff, so this returns only rows in branches the caller may see.
create or replace function public.top_up_list(p_statuses text[] default null)
returns table (
  id uuid, top_up_no text, branch_id uuid, branch_name text, amount numeric, paid_on date, payment_method text,
  reference text, bank_account_id uuid, bank_account_name text, paid_by text, note text, status text,
  requested_by uuid, requested_by_name text, requested_at timestamptz,
  member_id uuid, member_name text, membership_no text, member_plan_id uuid, plan_name text, contribution_id uuid,
  contribution_verified boolean, contribution_status text, logged_by_name text, logged_at timestamptz,
  decided_by_name text, decided_at timestamptz, decision_note text
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
         ds.full_name, r.decided_at, r.decision_note
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
  where (p_statuses is null or r.status = any (p_statuses))
    and (
      app.has_branch_permission('accounts.read', r.branch_id)
      or app.has_branch_permission('members.read', r.branch_id)
    )
  order by r.requested_at desc
  limit 500;
$$;

revoke all on function public.initiate_top_up(uuid, uuid, numeric, date, text, text, uuid, text, text) from public, anon;
revoke all on function public.log_top_up(uuid, uuid, text) from public, anon;
revoke all on function public.return_top_up(uuid, text) from public, anon;
revoke all on function public.cancel_top_up(uuid, text) from public, anon;
revoke all on function public.top_up_list(text[]) from public, anon;
grant execute on function public.initiate_top_up(uuid, uuid, numeric, date, text, text, uuid, text, text) to authenticated;
grant execute on function public.log_top_up(uuid, uuid, text) to authenticated;
grant execute on function public.return_top_up(uuid, text) to authenticated;
grant execute on function public.cancel_top_up(uuid, text) to authenticated;
grant execute on function public.top_up_list(text[]) to authenticated;

update public.permissions set description = 'Record contributions and reversals, and log top ups Accounts sends'
 where code = 'contributions.record';
