-- Branch Managers review everything about a member in their branch.
--
-- Until now a Branch Manager saw a member's file, documents, plans and contributions, but not the member's loans
-- (with their guarantors and schedules), the money Accounts paid in or out for the member, or the history of changes
-- to the file. This gives them all three, read-only and limited to the branches their role covers:
--
--   * credit.read + module.credit: the member's loans and the Credit pages, read-only (every Credit action needs a
--     further permission the Branch Manager doesn't have).
--   * members.full_view: two read-only functions for the member page, one listing the member's receipts and payments,
--     one listing the changes made to the member's records. Head of Administration and Internal Audit get it too.

insert into public.permissions (code, description) values
  ('members.full_view', 'See everything about a member: money paid in and out for them, and the history of their file')
on conflict (code) do nothing;

insert into public.role_permissions (role_code, permission_code) values
  ('branch_manager', 'members.full_view'),
  ('branch_manager', 'credit.read'),
  ('branch_manager', 'module.credit'),
  ('head_of_administration', 'members.full_view'),
  ('internal_auditor', 'members.full_view')
on conflict do nothing;

-- The member's receipts and payments (savings in, interest out, liquidation payouts, loan disbursements and
-- repayments), whatever their stage after draft. Accounts' transactions are otherwise only readable by Accounts.
create or replace function public.member_money_history(p_member_id uuid)
returns table (
  id uuid, txn_no text, direction text, transaction_type text, type_name text, status public.finance_status,
  txn_date date, amount numeric, interest_amount numeric, reference text, description text,
  member_plan_id uuid, plan_name text, loan_id uuid, loan_no text, liquidation_id uuid, liquidation_no text,
  paid_at timestamptz, posted_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select t.id, t.txn_no, t.direction, t.transaction_type, r.name, t.status,
         t.txn_date, t.amount, t.interest_amount, t.reference, t.description,
         t.member_plan_id, pt.name, t.loan_id, l.loan_no, t.liquidation_id, q.liquidation_no,
         t.paid_at, t.posted_at
  from public.members m
  join public.finance_transactions t on t.member_id = m.id
  join public.posting_rules r on r.transaction_type = t.transaction_type
  left join public.member_plans p on p.id = t.member_plan_id
  left join public.plan_types pt on pt.code = p.plan_type
  left join public.loans l on l.id = t.loan_id
  left join public.plan_liquidations q on q.id = t.liquidation_id
  where m.id = p_member_id
    and t.status <> 'draft'
    and app.has_branch_permission('members.full_view', m.branch_id)
  order by t.txn_date desc, t.created_at desc;
$$;

-- Who changed what on the member's file, plans, contributions, documents and liquidations (and loans, for staff who
-- can read loans). Field names, the new status and which record it was: the other values stay in the audit trail.
create or replace function public.member_history(p_member_id uuid)
returns table (
  occurred_at timestamptz, actor_id uuid, actor_name text, record_type text, record_id text, action text,
  changed_fields text[], status text, detail text
)
language sql
stable
security definer
set search_path = ''
as $$
  select a.occurred_at, a.actor_id, s.full_name,
         replace(a.table_name, 'public.', ''), a.record_id, a.action,
         array(select f from unnest(a.changed_fields) f where f not in ('updated_at')),
         case when a.action = 'INSERT' or 'status' = any (a.changed_fields) then a.new_data ->> 'status' end,
         -- Which record: the loan or liquidation number, the document or plan type, or the contribution's amount.
         coalesce(
           coalesce(a.new_data, a.old_data) ->> 'loan_no',
           coalesce(a.new_data, a.old_data) ->> 'liquidation_no',
           coalesce(a.new_data, a.old_data) ->> 'document_type',
           coalesce(a.new_data, a.old_data) ->> 'plan_type',
           case when a.table_name = 'public.contributions' then coalesce(a.new_data, a.old_data) ->> 'amount' end
         )
  from public.members m
  join public.audit_log a on a.branch_id = m.branch_id
  left join public.staff s on s.id = a.actor_id
  where m.id = p_member_id
    and app.has_branch_permission('members.full_view', m.branch_id)
    and (
      (a.table_name = 'public.members' and a.record_id = m.id::text)
      or (
        a.table_name in ('public.member_plans', 'public.contributions', 'public.member_documents', 'public.plan_liquidations')
        and coalesce(a.new_data, a.old_data) ->> 'member_id' = m.id::text
      )
      or (
        a.table_name = 'public.loans'
        and coalesce(a.new_data, a.old_data) ->> 'member_id' = m.id::text
        and app.has_branch_permission('credit.read', m.branch_id)
      )
    )
  order by a.occurred_at desc, a.id desc
  limit 300;
$$;

revoke all on function public.member_money_history(uuid) from public, anon;
revoke all on function public.member_history(uuid) from public, anon;
grant execute on function public.member_money_history(uuid) to authenticated;
grant execute on function public.member_history(uuid) to authenticated;
