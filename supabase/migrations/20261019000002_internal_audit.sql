-- Internal Audit: read-only oversight across every branch (from "INTERNAL AUDIT DEPARTMENT").
--
-- Auditors hold read permissions only (members.read, accounts.read, audit.trail.read, organisation-wide), so the
-- database refuses any change they attempt. Everything here is a security_invoker function: it runs with the
-- caller's row level security, so a branch-scoped user calling it sees only their own branches.

-- ---------------------------------------------------------------------------
-- Exceptions: incomplete KYC, unusual transactions, adjustments and control breaches
-- ---------------------------------------------------------------------------

create or replace function public.audit_exceptions(p_large_amount numeric default 1000000)
returns table (
  category text, severity text, branch_id uuid, record_type text, record_id uuid, summary text, detail text, occurred_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  -- Member files missing required KYC documents (drafts get two weeks before they count).
  select 'incomplete_kyc', case when m.status = 'approved' then 'high' else 'medium' end, m.branch_id, 'member', m.id,
         concat_ws(' ', m.first_name, m.last_name) || ' is missing KYC documents',
         'Status ' || m.status || '. Missing: ' || array_to_string(x.missing, ', '),
         coalesce(m.submitted_at, m.created_at)
  from public.members m
  cross join lateral (
    select array_agg(t::text order by t) as missing
    from unnest(array['kyc_form', 'nin_slip', 'means_of_id', 'utility_bill']::public.member_document_type[]) as t
    where not exists (select 1 from public.member_documents d where d.member_id = m.id and d.document_type = t)
  ) x
  where x.missing is not null and (m.status <> 'draft' or m.created_at < now() - interval '14 days')

  union all
  -- Files waiting on the Branch Manager for more than a week.
  select 'stale_approval', 'medium', m.branch_id, 'member', m.id,
         concat_ws(' ', m.first_name, m.last_name) || ' has waited over 7 days for approval',
         'Submitted ' || to_char(m.submitted_at, 'DD Mon YYYY'), m.submitted_at
  from public.members m
  where m.status = 'pending_approval' and m.submitted_at < now() - interval '7 days'

  union all
  -- Payments recorded but not verified within three days.
  select 'unverified_payment', 'medium', c.branch_id, 'contribution', c.id,
         'Contribution of ₦' || to_char(c.amount, 'FM999,999,999,990.00') || ' not verified',
         'Recorded ' || to_char(c.recorded_at, 'DD Mon YYYY') || coalesce(', reference ' || c.reference, ''), c.recorded_at
  from public.contributions c
  where c.verified_at is null and c.recorded_at < now() - interval '3 days'

  union all
  -- Adjustments: contribution reversals in the last 90 days.
  select 'adjustment', 'medium', c.branch_id, 'contribution', c.id,
         'Contribution reversed (₦' || to_char(abs(c.amount), 'FM999,999,999,990.00') || ')',
         'Reason: ' || coalesce(c.notes, '—'), c.recorded_at
  from public.contributions c
  where c.kind = 'reversal' and c.recorded_at > now() - interval '90 days'

  union all
  -- Adjustments: reversed journal entries in the last 90 days.
  select 'adjustment', 'medium', e.branch_id, 'journal_entry', e.id,
         'Journal ' || o.entry_no || ' reversed by ' || e.entry_no,
         'Reason: ' || coalesce(e.reversal_reason, '—'), e.posted_at
  from public.journal_entries e
  join public.journal_entries o on o.id = e.reverses_entry_id
  where e.posted_at > now() - interval '90 days'

  union all
  -- Changes to approved member records in the last 90 days.
  select 'approved_record_changed', 'medium', a.branch_id, 'member', a.record_id::uuid,
         'Approved member record changed: ' || concat_ws(' ', a.new_data ->> 'first_name', a.new_data ->> 'last_name'),
         'Fields: ' || array_to_string(array(select f from unnest(a.changed_fields) f where f not in ('updated_at', 'amendment_reason')), ', ')
           || '. Reason: ' || coalesce(a.new_data ->> 'amendment_reason', '—'),
         a.occurred_at
  from public.audit_log a
  where a.table_name = 'public.members' and a.action = 'UPDATE'
    and a.old_data ->> 'status' = 'approved' and a.new_data ->> 'status' = 'approved'
    and a.occurred_at > now() - interval '90 days'

  union all
  -- Unusually large amounts.
  select 'large_transaction', 'low', c.branch_id, 'contribution', c.id,
         'Large contribution of ₦' || to_char(abs(c.amount), 'FM999,999,999,990.00'),
         'Paid ' || to_char(c.paid_on, 'DD Mon YYYY') || coalesce(', reference ' || c.reference, ''), c.recorded_at
  from public.contributions c
  where abs(c.amount) >= p_large_amount
  union all
  select 'large_transaction', 'low', t.branch_id, 'finance_transaction', t.id,
         'Large ' || t.direction || ' ' || t.txn_no || ' of ₦' || to_char(t.amount, 'FM999,999,999,990.00'),
         t.description, t.created_at
  from public.finance_transactions t
  where t.amount >= p_large_amount and t.status not in ('draft', 'rejected')

  union all
  -- Segregation of duties breaches. The workflow functions prevent these, so any row here needs investigating.
  select 'segregation_breach', 'high', t.branch_id, 'finance_transaction', t.id,
         t.txn_no || ' was approved or paid by the person who prepared or approved it', t.description, t.approved_at
  from public.finance_transactions t
  where t.approved_by in (t.created_by, t.submitted_by) or t.paid_by = t.approved_by
  union all
  select 'segregation_breach', 'high', m.branch_id, 'member', m.id,
         concat_ws(' ', m.first_name, m.last_name) || ' was approved by the person who prepared the file', null, m.approved_at
  from public.members m
  where m.approved_by in (m.created_by, m.submitted_by)
  union all
  select 'segregation_breach', 'high', c.branch_id, 'contribution', c.id,
         'A contribution was verified by the person who recorded it', null, c.verified_at
  from public.contributions c
  where c.verified_by = c.recorded_by

  union all
  -- Bank lines nobody has explained after two weeks.
  select 'unmatched_bank_line', 'medium', s.branch_id, 'bank_statement_line', s.id,
         'Unmatched bank line of ₦' || to_char(s.amount, 'FM999,999,999,990.00'),
         to_char(s.line_date, 'DD Mon YYYY') || ': ' || s.description, s.line_date::timestamptz
  from public.bank_statement_lines s
  where s.status = 'unmatched' and s.line_date < current_date - 14

  union all
  -- Unidentified deposits still sitting in the holding account after two weeks.
  select 'unidentified_receipt', 'medium', t.branch_id, 'finance_transaction', t.id,
         'Unidentified deposit ' || t.txn_no || ' of ₦' || to_char(t.amount, 'FM999,999,999,990.00') || ' not cleared',
         t.description, t.posted_at
  from public.finance_transactions t
  where t.transaction_type = 'unidentified_receipt' and t.status = 'posted' and t.txn_date < current_date - 14

  union all
  -- Receipts and payment requests waiting more than three days for a decision.
  select 'stale_finance_approval', 'low', t.branch_id, 'finance_transaction', t.id,
         t.txn_no || ' has waited over 3 days for approval', t.description, t.submitted_at
  from public.finance_transactions t
  where t.status = 'submitted' and t.submitted_at < now() - interval '3 days'

  union all
  -- Posted journals that don't balance. The posting functions prevent this.
  select 'unbalanced_journal', 'high', e.branch_id, 'journal_entry', e.id,
         'Journal ' || e.entry_no || ' does not balance', e.description, e.posted_at
  from public.journal_entries e
  join public.journal_lines l on l.entry_id = e.id
  where e.status = 'posted'
  group by e.id
  having sum(l.debit) <> sum(l.credit)

  union all
  -- Deletions in the last 90 days (for example, KYC documents removed from a draft).
  select 'deletion', 'low', a.branch_id, replace(a.table_name, 'public.', ''), null,
         'Deleted from ' || replace(a.table_name, 'public.', ''),
         coalesce(a.old_data ->> 'file_name', a.old_data ->> 'name', a.record_id), a.occurred_at
  from public.audit_log a
  where a.action = 'DELETE' and a.occurred_at > now() - interval '90 days';
$$;

-- ---------------------------------------------------------------------------
-- Branch activity for the dashboard and the operational reports
-- ---------------------------------------------------------------------------

-- One row per branch and period: registrations, approvals, collections and posted cash movements.
create or replace function public.branch_operations(
  p_from date, p_to date, p_grain text default 'month', p_branch_id uuid default null, p_region_id uuid default null
)
returns table (
  period_start date, branch_id uuid, branch_name text, region_name text,
  registrations bigint, approvals bigint, contributions_count bigint, contributions_total numeric, top_ups_total numeric,
  reversals_total numeric, unverified_count bigint, receipts_total numeric, payments_total numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  with events as (
    select m.branch_id, m.created_at::date as day, 'registration' as kind, 0::numeric as amount, false as unverified
    from public.members m where m.created_at::date between p_from and p_to
    union all
    select m.branch_id, m.approved_at::date, 'approval', 0, false
    from public.members m where m.approved_at::date between p_from and p_to
    union all
    select c.branch_id, c.paid_on, c.kind::text, c.amount, c.verified_at is null
    from public.contributions c where c.paid_on between p_from and p_to
    union all
    select t.branch_id, t.txn_date, t.direction, t.amount, false
    from public.finance_transactions t where t.status = 'posted' and t.txn_date between p_from and p_to
  )
  select date_trunc(case when p_grain in ('day', 'week', 'month') then p_grain else 'month' end, ev.day)::date,
         b.id, b.name, r.name,
         count(*) filter (where ev.kind = 'registration'),
         count(*) filter (where ev.kind = 'approval'),
         count(*) filter (where ev.kind in ('scheduled', 'top_up')),
         coalesce(sum(ev.amount) filter (where ev.kind in ('scheduled', 'top_up', 'reversal')), 0)::numeric(16, 2),
         coalesce(sum(ev.amount) filter (where ev.kind = 'top_up'), 0)::numeric(16, 2),
         coalesce(sum(ev.amount) filter (where ev.kind = 'reversal'), 0)::numeric(16, 2),
         count(*) filter (where ev.unverified),
         coalesce(sum(ev.amount) filter (where ev.kind = 'receipt'), 0)::numeric(16, 2),
         coalesce(sum(ev.amount) filter (where ev.kind = 'payment'), 0)::numeric(16, 2)
  from events ev
  join public.branches b on b.id = ev.branch_id
  join public.regions r on r.id = b.region_id
  where (p_branch_id is null or b.id = p_branch_id)
    and (p_region_id is null or b.region_id = p_region_id)
  group by 1, b.id, r.name
  order by 1, b.name;
$$;

-- ---------------------------------------------------------------------------
-- Customer register: every member file with its KYC and contribution position
-- ---------------------------------------------------------------------------

create or replace function public.customer_register(p_branch_id uuid default null, p_region_id uuid default null)
returns table (
  member_id uuid, membership_no text, member_name text, branch_id uuid, status public.member_status, phone text, nin text,
  created_at timestamptz, approved_at timestamptz, missing_documents text, plan_count bigint, total_contributed numeric,
  total_verified numeric, unverified_count bigint, last_paid_on date, amendments bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select m.id, m.membership_no, concat_ws(' ', m.first_name, m.middle_name, m.last_name), m.branch_id, m.status, m.phone, m.nin,
         m.created_at, m.approved_at,
         (select string_agg(t::text, ', ' order by t)
            from unnest(array['kyc_form', 'nin_slip', 'means_of_id', 'utility_bill']::public.member_document_type[]) as t
            where not exists (select 1 from public.member_documents d where d.member_id = m.id and d.document_type = t)),
         (select count(*) from public.member_plans p where p.member_id = m.id),
         (select coalesce(sum(c.amount), 0) from public.contributions c where c.member_id = m.id)::numeric(16, 2),
         (select coalesce(sum(c.amount), 0) from public.contributions c where c.member_id = m.id and c.verified_at is not null)::numeric(16, 2),
         (select count(*) from public.contributions c where c.member_id = m.id and c.verified_at is null),
         (select max(c.paid_on) from public.contributions c where c.member_id = m.id),
         (select count(*) from public.audit_log a where a.table_name = 'public.members' and a.record_id = m.id::text
            and a.action = 'UPDATE' and a.old_data ->> 'status' = 'approved')
  from public.members m
  join public.branches b on b.id = m.branch_id
  where (p_branch_id is null or m.branch_id = p_branch_id)
    and (p_region_id is null or b.region_id = p_region_id)
  order by m.last_name, m.first_name;
$$;

-- Audit trail lookups by the record a change belongs to.
create index audit_log_member_idx on public.audit_log ((new_data ->> 'member_id')) where new_data ? 'member_id';
create index audit_log_transaction_idx on public.audit_log ((new_data ->> 'transaction_id')) where new_data ? 'transaction_id';

revoke all on function public.audit_exceptions(numeric) from public, anon;
revoke all on function public.branch_operations(date, date, text, uuid, uuid) from public, anon;
revoke all on function public.customer_register(uuid, uuid) from public, anon;
grant execute on function public.audit_exceptions(numeric) to authenticated;
grant execute on function public.branch_operations(date, date, text, uuid, uuid) to authenticated;
grant execute on function public.customer_register(uuid, uuid) to authenticated;
