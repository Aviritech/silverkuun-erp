-- Two flows from version 3 of the Accounts department flowchart:
--   1. Liquidation of a member's savings: Operations raises the request with the member's bank details, the Branch
--      Manager approves it, and Accounts pays it out through the usual payment chain (Accounts approval, Internal
--      Audit, proof of payment). When the payout posts, the plan is closed as liquidated.
--   2. The accountant who pays checks an approved payment before paying it. If the approval, amount, beneficiary or
--      documents aren't right, they send it back to the requester with the reason, and it isn't paid.

-- ===========================================================================
-- 1. Liquidation of a member's savings
-- ===========================================================================

insert into public.permissions (code, description) values
  ('liquidations.request', 'Raise a request to pay out a member''s savings when they liquidate their plan'),
  ('liquidations.approve', 'Approve, return or reject liquidation requests before Accounts pays them')
on conflict (code) do nothing;

insert into public.role_permissions (role_code, permission_code) values
  ('admin_officer', 'liquidations.request'),
  ('head_of_administration', 'liquidations.request'),
  ('branch_manager', 'liquidations.approve')
on conflict do nothing;

create sequence if not exists public.liquidation_no_seq;

create table public.plan_liquidations (
  id uuid primary key default gen_random_uuid(),
  liquidation_no text not null unique,
  member_plan_id uuid not null references public.member_plans (id) on delete restrict,
  member_id uuid not null references public.members (id) on delete restrict,
  branch_id uuid not null references public.branches (id),
  -- What is paid out, and the plan's verified savings when the request was raised, for the Branch Manager to compare.
  amount numeric(14, 2) not null check (amount > 0),
  plan_savings numeric(16, 2) not null default 0,
  -- Where the money goes.
  beneficiary_account_name text not null check (length(trim(beneficiary_account_name)) > 1),
  bank_code text references public.cbn_banks (code),
  bank_name text not null check (length(trim(bank_name)) > 0),
  bank_account_no text not null check (bank_account_no ~ '^[0-9]{10}$'),
  note text,
  status text not null default 'pending_approval'
    check (status in ('pending_approval', 'returned', 'approved', 'paid', 'rejected', 'cancelled')),
  requested_by uuid not null references public.staff (id),
  requested_at timestamptz not null default now(),
  decided_by uuid references public.staff (id),
  decided_at timestamptz,
  decision_note text,
  -- The payment in Accounts, kept in step by a trigger on finance_transactions.
  payment_txn_id uuid,
  payment_txn_no text,
  payment_status text,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);
create index plan_liquidations_branch_status_idx on public.plan_liquidations (branch_id, status);
create index plan_liquidations_member_idx on public.plan_liquidations (member_id);
-- One open request per plan.
create unique index plan_liquidations_one_open_idx on public.plan_liquidations (member_plan_id)
  where status in ('pending_approval', 'returned', 'approved');

-- Rows change only through the functions below.
create or replace function app.plan_liquidations_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not app.in_workflow() then
    raise exception 'liquidation requests change only through the liquidation workflow' using errcode = 'insufficient_privilege';
  end if;
  if tg_op = 'DELETE' then
    raise exception 'liquidation requests are never deleted; cancel them instead' using errcode = 'insufficient_privilege';
  end if;
  if new.bank_code is not null then
    select name into new.bank_name from public.cbn_banks where code = new.bank_code;
  end if;
  return new;
end;
$$;

create trigger plan_liquidations_guard
  before insert or update or delete on public.plan_liquidations
  for each row execute function app.plan_liquidations_guard();

select app.enable_audit('public.plan_liquidations');

alter table public.plan_liquidations enable row level security;
create policy "operations and accounts read liquidations in their branches" on public.plan_liquidations for select to authenticated
  using (
    app.has_branch_permission('members.read', branch_id)
    or app.has_branch_permission('accounts.read', branch_id)
  );

-- A plan's verified savings at a date: the same figure the interest schedule uses.
create or replace function app.plan_savings(p_plan_id uuid, p_date date default current_date)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(c.amount), 0)::numeric(16, 2)
  from public.contributions c
  where c.member_plan_id = p_plan_id and c.verified_at is not null and c.paid_on <= p_date;
$$;
revoke all on function app.plan_savings(uuid, date) from public, anon;
grant execute on function app.plan_savings(uuid, date) to authenticated;

-- Operations raises a liquidation request, or corrects and resends one the Branch Manager or Accounts sent back.
create or replace function public.request_liquidation(
  p_id uuid, p_plan_id uuid, p_amount numeric, p_account_name text, p_bank_code text, p_bank_name text,
  p_account_no text, p_note text
)
returns public.plan_liquidations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan public.member_plans;
  v_row public.plan_liquidations;
begin
  if p_id is not null then
    select * into v_row from public.plan_liquidations where id = p_id for update;
    if not found or not app.has_branch_permission('liquidations.request', v_row.branch_id) then
      raise exception 'liquidation request not found' using errcode = 'no_data_found';
    end if;
    if v_row.status <> 'returned' then
      raise exception 'only a request that was sent back can be changed and sent again' using errcode = 'check_violation';
    end if;
    p_plan_id := v_row.member_plan_id;
  end if;

  select * into v_plan from public.member_plans where id = p_plan_id;
  if not found or not app.has_branch_permission('liquidations.request', v_plan.branch_id) then
    raise exception 'plan not found' using errcode = 'no_data_found';
  end if;
  if v_plan.status not in ('active', 'matured') then
    raise exception 'this plan is % and can''t be liquidated', v_plan.status using errcode = 'check_violation';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'enter the amount to pay the member' using errcode = 'check_violation';
  end if;
  if p_account_name is null or length(trim(p_account_name)) < 2 then
    raise exception 'enter the name on the member''s bank account' using errcode = 'check_violation';
  end if;
  if nullif(trim(coalesce(p_bank_code, '')), '') is null and nullif(trim(coalesce(p_bank_name, '')), '') is null then
    raise exception 'choose the member''s bank' using errcode = 'check_violation';
  end if;
  if p_account_no is null or trim(p_account_no) !~ '^[0-9]{10}$' then
    raise exception 'the account number must be 10 digits' using errcode = 'check_violation';
  end if;

  perform app.begin_workflow();
  if p_id is null then
    insert into public.plan_liquidations (
      liquidation_no, member_plan_id, member_id, branch_id, amount, plan_savings, beneficiary_account_name, bank_code,
      bank_name, bank_account_no, note, status, requested_by, requested_at
    ) values (
      'LIQ-' || lpad(nextval('public.liquidation_no_seq')::text, 6, '0'), v_plan.id, v_plan.member_id, v_plan.branch_id,
      p_amount, app.plan_savings(v_plan.id), trim(p_account_name), nullif(trim(coalesce(p_bank_code, '')), ''),
      coalesce(nullif(trim(coalesce(p_bank_name, '')), ''), '-'), trim(p_account_no), nullif(trim(coalesce(p_note, '')), ''),
      'pending_approval', auth.uid(), now()
    ) returning * into v_row;
  else
    update public.plan_liquidations
       set amount = p_amount, plan_savings = app.plan_savings(v_plan.id), beneficiary_account_name = trim(p_account_name),
           bank_code = nullif(trim(coalesce(p_bank_code, '')), ''),
           bank_name = coalesce(nullif(trim(coalesce(p_bank_name, '')), ''), '-'), bank_account_no = trim(p_account_no),
           note = nullif(trim(coalesce(p_note, '')), ''), status = 'pending_approval', requested_by = auth.uid(),
           requested_at = now(), decided_by = null, decided_at = null
     where id = p_id
     returning * into v_row;
  end if;
  perform app.end_workflow();
  return v_row;
exception
  when unique_violation then
    raise exception 'this plan already has a liquidation request in progress' using errcode = 'check_violation';
end;
$$;

-- The Branch Manager approves (on to Accounts) or rejects a request.
create or replace function public.decide_liquidation(p_id uuid, p_approve boolean, p_note text)
returns public.plan_liquidations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.plan_liquidations;
begin
  select * into v_row from public.plan_liquidations where id = p_id for update;
  if not found or not app.has_branch_permission('liquidations.approve', v_row.branch_id) then
    raise exception 'liquidation request not found' using errcode = 'no_data_found';
  end if;
  if v_row.status <> 'pending_approval' then
    raise exception 'only requests waiting for the Branch Manager can be decided' using errcode = 'check_violation';
  end if;
  if auth.uid() = v_row.requested_by then
    raise exception 'you raised this request, so someone else must approve it' using errcode = 'insufficient_privilege';
  end if;
  if not p_approve and (p_note is null or length(trim(p_note)) < 5) then
    raise exception 'say why the request is rejected' using errcode = 'check_violation';
  end if;

  perform app.begin_workflow();
  update public.plan_liquidations
     set status = case when p_approve then 'approved' else 'rejected' end, decided_by = auth.uid(), decided_at = now(),
         decision_note = nullif(trim(coalesce(p_note, '')), '')
   where id = p_id
   returning * into v_row;
  perform app.end_workflow();
  return v_row;
end;
$$;

-- Back to Operations for correction: by the Branch Manager before deciding, or by Accounts before paying (while no
-- payment for it is in progress).
create or replace function public.return_liquidation(p_id uuid, p_reason text)
returns public.plan_liquidations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.plan_liquidations;
  v_by text;
begin
  select * into v_row from public.plan_liquidations where id = p_id for update;
  if not found then
    raise exception 'liquidation request not found' using errcode = 'no_data_found';
  end if;
  if v_row.status = 'pending_approval' and app.has_branch_permission('liquidations.approve', v_row.branch_id) then
    v_by := 'Branch Manager';
    if auth.uid() = v_row.requested_by then
      raise exception 'you raised this request, so someone else must review it' using errcode = 'insufficient_privilege';
    end if;
  elsif v_row.status = 'approved' and app.has_branch_permission('accounts.payments.request', v_row.branch_id) then
    v_by := 'Accounts';
    if exists (
      select 1 from public.finance_transactions t
      where t.liquidation_id = p_id and t.status not in ('rejected', 'reversed')
    ) then
      raise exception 'a payment for this request is in progress in Accounts; reject that payment first' using errcode = 'check_violation';
    end if;
  elsif app.has_branch_permission('liquidations.approve', v_row.branch_id)
     or app.has_branch_permission('accounts.payments.request', v_row.branch_id) then
    raise exception 'this request can''t be sent back now' using errcode = 'check_violation';
  else
    raise exception 'liquidation request not found' using errcode = 'no_data_found';
  end if;
  if p_reason is null or length(trim(p_reason)) < 5 then
    raise exception 'say what needs correcting' using errcode = 'check_violation';
  end if;

  perform app.begin_workflow();
  update public.plan_liquidations
     set status = 'returned', decided_by = auth.uid(), decided_at = now(), decision_note = v_by || ': ' || trim(p_reason)
   where id = p_id
   returning * into v_row;
  perform app.end_workflow();
  return v_row;
end;
$$;

-- Operations withdraws a request that hasn't been approved (for example, the member changed their mind).
create or replace function public.cancel_liquidation(p_id uuid, p_reason text)
returns public.plan_liquidations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.plan_liquidations;
begin
  select * into v_row from public.plan_liquidations where id = p_id for update;
  if not found or not app.has_branch_permission('liquidations.request', v_row.branch_id) then
    raise exception 'liquidation request not found' using errcode = 'no_data_found';
  end if;
  if v_row.status not in ('pending_approval', 'returned') then
    raise exception 'only requests that aren''t approved yet can be cancelled' using errcode = 'check_violation';
  end if;
  if p_reason is null or length(trim(p_reason)) < 5 then
    raise exception 'say why the request is cancelled' using errcode = 'check_violation';
  end if;

  perform app.begin_workflow();
  update public.plan_liquidations
     set status = 'cancelled', decision_note = 'Cancelled: ' || trim(p_reason), decided_by = auth.uid(), decided_at = now()
   where id = p_id
   returning * into v_row;
  perform app.end_workflow();
  return v_row;
end;
$$;

-- The payment that pays out an approved liquidation.
alter table public.finance_transactions
  add column liquidation_id uuid references public.plan_liquidations (id);
create index finance_transactions_liquidation_idx on public.finance_transactions (liquidation_id) where liquidation_id is not null;

-- Runs after finance_transactions_guard (alphabetical order). A payout matches its approved request exactly.
create or replace function app.finance_transactions_liquidation_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.plan_liquidations;
begin
  if tg_op = 'UPDATE' and app.in_workflow() then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.liquidation_id is distinct from old.liquidation_id then
    raise exception 'a payout stays with its liquidation request; reject it and raise a new one' using errcode = 'check_violation';
  end if;
  if new.liquidation_id is null then
    return new;
  end if;

  select * into v_row from public.plan_liquidations where id = new.liquidation_id;
  if v_row.status <> 'approved' then
    raise exception 'only liquidation requests the Branch Manager approved can be paid' using errcode = 'check_violation';
  end if;
  if new.direction <> 'payment' or new.transaction_type <> 'savings_withdrawal' then
    raise exception 'a liquidation is paid as a member savings withdrawal' using errcode = 'check_violation';
  end if;
  if new.branch_id <> v_row.branch_id then
    raise exception 'pay the liquidation from a bank or cash account of the member''s branch' using errcode = 'check_violation';
  end if;
  if new.amount <> v_row.amount then
    raise exception 'the payout must be the approved amount of ₦%', to_char(v_row.amount, 'FM999,999,999,990.00')
      using errcode = 'check_violation';
  end if;
  if exists (
    select 1 from public.finance_transactions t
    where t.liquidation_id = new.liquidation_id and t.id <> new.id and t.status not in ('rejected', 'reversed')
  ) then
    raise exception 'this liquidation already has a payment in Accounts' using errcode = 'check_violation';
  end if;
  new.member_id := v_row.member_id;
  return new;
end;
$$;

create trigger finance_transactions_liquidation_guard
  before insert or update on public.finance_transactions
  for each row execute function app.finance_transactions_liquidation_guard();

-- Keeps the liquidation in step with its payment, and closes the plan when the payout posts.
create or replace function app.finance_transactions_liquidation_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_was_on boolean := app.in_workflow();
  v_row public.plan_liquidations;
begin
  if new.liquidation_id is null or (tg_op = 'UPDATE' and new.status is not distinct from old.status) then
    return null;
  end if;
  select * into v_row from public.plan_liquidations where id = new.liquidation_id for update;
  perform app.begin_workflow();
  update public.plan_liquidations
     set payment_txn_id = new.id, payment_txn_no = new.txn_no, payment_status = new.status::text
   where id = v_row.id;
  if new.status = 'posted' then
    update public.plan_liquidations set status = 'paid', paid_at = now() where id = v_row.id;
    update public.member_plans set status = 'liquidated', closed_at = now() where id = v_row.member_plan_id;
  elsif new.status = 'reversed' and v_row.status = 'paid' then
    update public.plan_liquidations set status = 'approved', paid_at = null where id = v_row.id;
    update public.member_plans set status = 'active', closed_at = null where id = v_row.member_plan_id;
  end if;
  if not v_was_on then
    perform app.end_workflow();
  end if;
  return null;
end;
$$;

create trigger finance_transactions_liquidation_events
  after insert or update on public.finance_transactions
  for each row execute function app.finance_transactions_liquidation_events();

-- Accounts raises the payout for an approved liquidation and sends it for approval. The Branch Manager's approval is
-- its supporting document, so no upload is needed.
create or replace function public.raise_liquidation_payment(p_id uuid, p_bank_account_id uuid, p_txn_date date default current_date)
returns public.finance_transactions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.plan_liquidations;
  v_plan_name text;
  v_attempt int;
  v_txn public.finance_transactions;
begin
  select * into v_row from public.plan_liquidations where id = p_id for update;
  if not found or not app.has_branch_permission('accounts.payments.request', v_row.branch_id) then
    raise exception 'liquidation request not found' using errcode = 'no_data_found';
  end if;
  if not exists (select 1 from public.bank_accounts b where b.id = p_bank_account_id and b.branch_id = v_row.branch_id and b.is_active) then
    raise exception 'choose an active bank or cash account of the member''s branch' using errcode = 'check_violation';
  end if;
  select pt.name into v_plan_name
  from public.member_plans p join public.plan_types pt on pt.code = p.plan_type where p.id = v_row.member_plan_id;
  select count(*) + 1 into v_attempt from public.finance_transactions where liquidation_id = p_id;

  insert into public.finance_transactions (
    direction, transaction_type, txn_date, amount, bank_account_id, member_id, liquidation_id, counterparty, reference,
    description, branch_id
  ) values (
    'payment', 'savings_withdrawal', coalesce(p_txn_date, current_date), v_row.amount, p_bank_account_id, v_row.member_id,
    p_id, v_row.beneficiary_account_name,
    v_row.liquidation_no || case when v_attempt > 1 then '/' || v_attempt else '' end,
    format('Liquidation %s of %s plan: pay %s, %s %s', v_row.liquidation_no, v_plan_name, v_row.beneficiary_account_name,
           v_row.bank_name, v_row.bank_account_no),
    v_row.branch_id
  ) returning * into v_txn;

  return public.submit_finance_transaction(v_txn.id);
end;
$$;

-- Unchanged, except that a liquidation payout uses the Branch Manager's approval as its evidence.
create or replace function public.submit_finance_transaction(p_id uuid)
returns public.finance_transactions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_txn public.finance_transactions;
begin
  select * into v_txn from public.finance_transactions where id = p_id for update;
  if not found or not app.has_branch_permission(
    case when v_txn.direction = 'receipt' then 'accounts.receipts.record' else 'accounts.payments.request' end, v_txn.branch_id
  ) then
    raise exception 'transaction not found' using errcode = 'no_data_found';
  end if;
  if v_txn.status not in ('draft', 'returned') then
    raise exception 'only draft or returned transactions can be submitted' using errcode = 'check_violation';
  end if;
  if v_txn.contribution_id is null and v_txn.statement_line_id is null
     and not (v_txn.transaction_type = 'loan_disbursement' and v_txn.loan_id is not null)
     and v_txn.liquidation_id is null
     and not exists (select 1 from public.finance_attachments a where a.transaction_id = p_id and a.kind = 'supporting') then
    raise exception 'attach the supporting evidence (receipt, invoice or approval) before submitting' using errcode = 'check_violation';
  end if;
  if v_txn.needs_ops_confirmation and v_txn.transaction_type = 'member_savings' and v_txn.member_plan_id is null then
    raise exception 'choose the savings plan the money was paid into' using errcode = 'check_violation';
  end if;

  perform app.begin_workflow();
  update public.finance_transactions
     set status = 'submitted', submitted_by = auth.uid(), submitted_at = now(), decision_reason = null,
         ops_confirmed_by = null, ops_confirmed_at = null, ops_note = null
   where id = p_id
   returning * into v_txn;
  perform app.end_workflow();
  return v_txn;
end;
$$;

-- Operations, the Branch Manager and Accounts see each other's names on a liquidation without reading the staff
-- directory: the queue for a page comes from here.
create or replace function public.liquidation_requests(p_status text[] default null)
returns table (
  id uuid, liquidation_no text, branch_id uuid, branch_name text, status text, amount numeric, plan_savings numeric,
  member_id uuid, member_name text, membership_no text, member_plan_id uuid, plan_name text, start_date date,
  maturity_date date, beneficiary_account_name text, bank_code text, bank_name text, bank_account_no text, note text,
  requested_by uuid, requested_by_name text, requested_at timestamptz, decided_by uuid, decided_by_name text,
  decided_at timestamptz, decision_note text, payment_txn_id uuid, payment_txn_no text, payment_status text, paid_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select l.id, l.liquidation_no, l.branch_id, b.name, l.status, l.amount, l.plan_savings,
         m.id, concat_ws(' ', m.first_name, m.middle_name, m.last_name), m.membership_no, p.id, pt.name, p.start_date,
         p.maturity_date, l.beneficiary_account_name, l.bank_code, l.bank_name, l.bank_account_no, l.note,
         l.requested_by, rs.full_name, l.requested_at, l.decided_by, ds.full_name, l.decided_at, l.decision_note,
         l.payment_txn_id, l.payment_txn_no, l.payment_status, l.paid_at
  from public.plan_liquidations l
  join public.branches b on b.id = l.branch_id
  join public.members m on m.id = l.member_id
  join public.member_plans p on p.id = l.member_plan_id
  join public.plan_types pt on pt.code = p.plan_type
  join public.staff rs on rs.id = l.requested_by
  left join public.staff ds on ds.id = l.decided_by
  where (p_status is null or l.status = any (p_status))
    and (app.has_branch_permission('members.read', l.branch_id) or app.has_branch_permission('accounts.read', l.branch_id))
  order by l.requested_at desc;
$$;

revoke all on function public.request_liquidation(uuid, uuid, numeric, text, text, text, text, text) from public, anon;
revoke all on function public.decide_liquidation(uuid, boolean, text) from public, anon;
revoke all on function public.return_liquidation(uuid, text) from public, anon;
revoke all on function public.cancel_liquidation(uuid, text) from public, anon;
revoke all on function public.raise_liquidation_payment(uuid, uuid, date) from public, anon;
revoke all on function public.liquidation_requests(text[]) from public, anon;
grant execute on function public.request_liquidation(uuid, uuid, numeric, text, text, text, text, text) to authenticated;
grant execute on function public.decide_liquidation(uuid, boolean, text) to authenticated;
grant execute on function public.return_liquidation(uuid, text) to authenticated;
grant execute on function public.cancel_liquidation(uuid, text) to authenticated;
grant execute on function public.raise_liquidation_payment(uuid, uuid, date) to authenticated;
grant execute on function public.liquidation_requests(text[]) to authenticated;

-- ===========================================================================
-- 2. The paying accountant can send an approved payment back instead of paying it
-- ===========================================================================

-- Checks before paying: the approvals, amount, beneficiary and documents. If something is wrong, the payment goes back
-- to whoever requested it, with the reason, and must be approved again (by Accounts and Internal Audit) after the fix.
create or replace function public.return_payment_before_paying(p_id uuid, p_reason text)
returns public.finance_transactions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_txn public.finance_transactions;
begin
  select * into v_txn from public.finance_transactions where id = p_id for update;
  if not found or not (
    app.has_branch_permission('accounts.payments.pay', v_txn.branch_id)
    -- The payments desk that pays for every branch (when that permission exists).
    or (v_txn.direction = 'payment' and app.has_permission('accounts.payments.pay')
        and app.has_permission('accounts.payments.all_branches'))
  ) then
    raise exception 'transaction not found' using errcode = 'no_data_found';
  end if;
  if v_txn.direction <> 'payment' or v_txn.status <> 'approved' then
    raise exception 'only approved payments that haven''t been paid can be sent back here' using errcode = 'check_violation';
  end if;
  if p_reason is null or length(trim(p_reason)) < 5 then
    raise exception 'say what needs correcting before this can be paid' using errcode = 'check_violation';
  end if;

  perform app.begin_workflow();
  update public.finance_transactions
     set status = 'returned', decision_reason = 'Payments: ' || trim(p_reason),
         approved_by = null, approved_at = null, audited_by = null, audited_at = null
   where id = p_id
   returning * into v_txn;
  perform app.end_workflow();
  return v_txn;
end;
$$;

revoke all on function public.return_payment_before_paying(uuid, text) from public, anon;
grant execute on function public.return_payment_before_paying(uuid, text) to authenticated;
