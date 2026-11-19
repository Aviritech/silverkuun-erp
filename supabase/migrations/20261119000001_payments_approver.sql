-- Angela approves payment requests (sosa, 2026-11-19).
--
-- New permission accounts.payments.approve: approve, return or reject a submitted payment request. It does not cover
-- receipts, supplier bills or bank reconciliations, which still need accounts.transactions.approve. It is held by the
-- new Payments Approver role. The usual rules still apply: nobody approves a payment they raised or submitted, the
-- approver can't also pay it, and Internal Audit approves every payment before it is paid.

insert into public.permissions (code, description) values
  ('accounts.payments.approve', 'Approve, return or reject payment requests raised by someone else')
on conflict (code) do nothing;

insert into public.roles (code, department_code, name, description) values
  ('payments_approver', 'accounts', 'Payments Approver',
   'Approves, returns or rejects payment requests raised by someone else, before Internal Audit approves them')
on conflict (code) do nothing;

insert into public.role_permissions (role_code, permission_code) values
  ('payments_approver', 'module.accounts'),
  ('payments_approver', 'accounts.read'),
  ('payments_approver', 'accounts.payments.approve'),
  ('payments_approver', 'members.read')
on conflict do nothing;

-- Same as 20261118000001, plus accounts.payments.approve for payments.
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
      or app.has_branch_permission('accounts.payments.approve', p_txn.branch_id)
  end;
$$;
revoke all on function app.may_decide_transaction(public.finance_transactions, boolean) from public, anon, authenticated;
