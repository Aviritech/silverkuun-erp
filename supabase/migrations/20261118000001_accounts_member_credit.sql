-- Only one person credits a member's account (sosa, 2026-11-18).
--
-- "Naimat: confirmation of receipts. She should be the only one that has the access to credit a member's account,
--  whether for loan repayment or savings. She should also be able to make postings in the account books, monitor loan
--  repayment from customers and do the aging report. Angela: payments, general view of the accounts department and
--  postings. Virtue: general view of the accounts and postings."
--
-- What "credit a member's account" means here: posting anything that raises a member's balance on the ledger accounts
-- the member statements read (savings 2110, fixed term 2120, matured payable 2130, ROI payable 2140, capital 3100) or
-- lowers what the member owes (loans 1210/1220, loan interest 4100). Three paths can do that:
--   1. confirming (approving) a member savings, capital or loan repayment receipt, which posts it;
--   2. posting a manual journal with such a credit line for a member;
--   3. reversing a posted entry that debited a member (for example a savings withdrawal).
-- All three now need the new permission accounts.members.credit, held only by the new Receipts Confirmation
-- Accountant role, and at most one active person may hold that role at a time.
--
-- Also new: an Accounts Officer role (read everything in Accounts in all branches, prepare and post journals). The
-- usual four-eyes rules still apply: nobody confirms a receipt they keyed in, and nobody posts their own journal.

-- ---------------------------------------------------------------------------
-- Permission and roles
-- ---------------------------------------------------------------------------

insert into public.permissions (code, description) values
  ('accounts.members.credit', 'Credit a member''s account: confirm savings, capital and loan repayment receipts and post entries that credit a member')
on conflict (code) do nothing;

insert into public.roles (code, department_code, name, description) values
  ('receipts_confirmer', 'accounts', 'Receipts Confirmation Accountant',
   'The only person who credits members'' accounts: confirms savings, capital and loan repayment receipts, posts journals that credit a member, and follows up loan repayments and the aging report'),
  ('accounts_officer', 'accounts', 'Accounts Officer',
   'Read-only view of every Accounts page in all branches; prepares and posts journal entries in the books')
on conflict (code) do nothing;

insert into public.role_permissions (role_code, permission_code) values
  ('receipts_confirmer', 'module.accounts'),
  ('receipts_confirmer', 'accounts.read'),
  ('receipts_confirmer', 'accounts.members.credit'),
  ('receipts_confirmer', 'members.read'),
  ('accounts_officer', 'module.accounts'),
  ('accounts_officer', 'accounts.read'),
  ('accounts_officer', 'accounts.journals.prepare'),
  ('accounts_officer', 'accounts.journals.post'),
  ('accounts_officer', 'members.read')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- What counts as crediting a member
-- ---------------------------------------------------------------------------

-- Ledger accounts that make up a member's position (the same accounts public.member_balances reads).
create or replace function app.member_ledger_accounts()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['2110', '2120', '2130', '2140', '3100', '1210', '1220', '4100'];
$$;

-- True when posting this receipt would credit a member's account.
create or replace function app.receipt_credits_member(p_txn public.finance_transactions)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_txn.direction = 'receipt' and p_txn.member_id is not null and exists (
    select 1 from public.posting_rules r
    where r.transaction_type = p_txn.transaction_type
      and (r.credit_account = any (app.member_ledger_accounts()) or r.interest_account = any (app.member_ledger_accounts()))
  );
$$;

-- True when the journal entry has a line that credits a member's account.
create or replace function app.entry_credits_member(p_entry_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.journal_lines l
    where l.entry_id = p_entry_id and l.member_id is not null and l.credit > 0
      and l.account_code = any (app.member_ledger_accounts())
  );
$$;

revoke all on function app.member_ledger_accounts() from public, anon;
revoke all on function app.receipt_credits_member(public.finance_transactions) from public, anon, authenticated;
revoke all on function app.entry_credits_member(uuid) from public, anon, authenticated;
grant execute on function app.member_ledger_accounts() to authenticated;

-- ---------------------------------------------------------------------------
-- 1. Confirming receipts
-- ---------------------------------------------------------------------------

-- Who may decide on a submitted receipt or payment request. Receipts that credit a member need accounts.members.credit;
-- other receipts can be confirmed by either an approver or the Receipts Confirmation Accountant; payments are unchanged.
create or replace function app.may_decide_transaction(p_txn public.finance_transactions, p_posts boolean)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_txn.direction = 'receipt' and p_posts and app.receipt_credits_member(p_txn)
      then app.has_branch_permission('accounts.members.credit', p_txn.branch_id)
    when p_txn.direction = 'receipt'
      then app.has_branch_permission('accounts.transactions.approve', p_txn.branch_id)
        or app.has_branch_permission('accounts.members.credit', p_txn.branch_id)
    else app.has_branch_permission('accounts.transactions.approve', p_txn.branch_id)
  end;
$$;
revoke all on function app.may_decide_transaction(public.finance_transactions, boolean) from public, anon, authenticated;

create or replace function public.approve_finance_transaction(p_id uuid)
returns public.finance_transactions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_txn public.finance_transactions;
begin
  select * into v_txn from public.finance_transactions where id = p_id for update;
  if not found or not app.has_branch_permission('accounts.read', v_txn.branch_id) then
    raise exception 'transaction not found' using errcode = 'no_data_found';
  end if;
  if not app.may_decide_transaction(v_txn, true) then
    if app.receipt_credits_member(v_txn) then
      raise exception 'only the Receipts Confirmation Accountant can credit a member''s account' using errcode = 'insufficient_privilege';
    end if;
    raise exception 'you can''t approve this transaction' using errcode = 'insufficient_privilege';
  end if;
  if v_txn.status <> 'submitted' then
    raise exception 'only submitted transactions can be approved' using errcode = 'check_violation';
  end if;
  if auth.uid() in (v_txn.created_by, v_txn.submitted_by) then
    raise exception 'you prepared this transaction, so someone else must approve it' using errcode = 'insufficient_privilege';
  end if;
  if v_txn.needs_ops_confirmation and v_txn.ops_confirmed_at is null then
    raise exception 'Operations has to confirm this receipt against the member''s records first' using errcode = 'check_violation';
  end if;

  perform app.begin_workflow();
  update public.finance_transactions
     set status = 'approved', approved_by = auth.uid(), approved_at = now()
   where id = p_id;
  perform app.end_workflow();

  -- Receipts post as soon as they are confirmed; payments wait for proof that the money went out.
  if v_txn.direction = 'receipt' then
    perform app.post_finance_transaction(p_id);
  end if;

  select * into v_txn from public.finance_transactions where id = p_id;
  return v_txn;
end;
$$;

-- Returning or rejecting doesn't credit anyone, so approvers keep it and the Receipts Confirmation Accountant gains it
-- for receipts.
create or replace function public.decline_finance_transaction(p_id uuid, p_outcome text, p_reason text)
returns public.finance_transactions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_txn public.finance_transactions;
begin
  select * into v_txn from public.finance_transactions where id = p_id for update;
  if not found or not app.may_decide_transaction(v_txn, false) then
    raise exception 'transaction not found' using errcode = 'no_data_found';
  end if;
  if p_outcome not in ('returned', 'rejected') then
    raise exception 'choose to return or reject' using errcode = 'check_violation';
  end if;
  if v_txn.status <> 'submitted' then
    raise exception 'only submitted transactions can be returned or rejected' using errcode = 'check_violation';
  end if;
  if auth.uid() in (v_txn.created_by, v_txn.submitted_by) then
    raise exception 'you prepared this transaction, so someone else must review it' using errcode = 'insufficient_privilege';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'give a reason' using errcode = 'check_violation';
  end if;

  perform app.begin_workflow();
  update public.finance_transactions
     set status = p_outcome::public.finance_status, decision_reason = trim(p_reason)
   where id = p_id
   returning * into v_txn;
  perform app.end_workflow();
  return v_txn;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2 and 3. Journals and reversals: one check where every entry becomes posted
-- ---------------------------------------------------------------------------

-- Every journal (receipt, payment, manual, reversal, bill, payroll) is written as a draft and then switched to posted,
-- so this is the one place all of them pass. A signed-in user may only post an entry that credits a member if they
-- hold accounts.members.credit for its branch. Jobs that run without a user (seed scripts, server jobs) are not
-- people and are left alone.
create or replace function app.journal_member_credit_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'draft' and new.status = 'posted' and auth.uid() is not null
     and app.entry_credits_member(new.id)
     and not app.has_branch_permission('accounts.members.credit', new.branch_id) then
    raise exception 'only the Receipts Confirmation Accountant can credit a member''s account' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

drop trigger if exists journal_member_credit_guard on public.journal_entries;
create trigger journal_member_credit_guard
  before update of status on public.journal_entries
  for each row execute function app.journal_member_credit_guard();

-- ---------------------------------------------------------------------------
-- One holder at a time
-- ---------------------------------------------------------------------------

-- At most one active staff member may hold a role that credits members' accounts. To hand it over, remove the
-- current holder's role first; both changes are in the audit trail.
create or replace function app.single_member_creditor_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.role_permissions rp
             where rp.role_code = new.role_code and rp.permission_code = 'accounts.members.credit')
     and exists (
       select 1
       from public.staff_roles sr
       join public.staff s on s.id = sr.staff_id and s.is_active
       join public.role_permissions rp on rp.role_code = sr.role_code and rp.permission_code = 'accounts.members.credit'
       where sr.staff_id <> new.staff_id
     ) then
    raise exception 'only one person may credit members'' accounts; remove the role from the current holder first'
      using errcode = 'unique_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists single_member_creditor_guard on public.staff_roles;
create trigger single_member_creditor_guard
  before insert or update of staff_id, role_code on public.staff_roles
  for each row execute function app.single_member_creditor_guard();
