-- Accounts can find the member when recording a top up.
--   * top_up_member_search() looks up approved members by name, membership number or phone, only in the branches the
--     accountant records receipts for, and returns each member's branch and active savings plans.
--   * initiate_top_up() takes the member (and optionally the plan) Accounts picked. The member must belong to the
--     branch the top up goes to, and the plan must be one of that member's active plans.
--   * The branch officer sees who Accounts matched it to and the plan is pre-selected, but still logs it (or sends it
--     back), so the officer remains the check that the money is the member's. A top up with no match (a transfer whose
--     name doesn't match a member) works exactly as before.

alter table public.top_up_requests
  add column matched_member_id uuid references public.members (id),
  add column matched_plan_id uuid references public.member_plans (id),
  add constraint top_up_requests_plan_needs_member check (matched_plan_id is null or matched_member_id is not null);

comment on column public.top_up_requests.matched_member_id is 'The member Accounts picked when recording it; the branch officer confirms by logging.';
comment on column public.top_up_requests.matched_plan_id is 'The plan Accounts picked, if any; pre-selected for the branch officer.';

-- Member lookup for Accounts. Security definer because receipts accountants don't read the members table; it returns
-- only what's needed to match a payment, and only for branches the caller records receipts in.
create or replace function public.top_up_member_search(p_query text)
returns table (
  member_id uuid, member_name text, membership_no text, phone_hint text, branch_id uuid, branch_name text, plans jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  with q as (
    select lower(trim(coalesce(p_query, ''))) as text,
           regexp_replace(coalesce(p_query, ''), '\D', '', 'g') as digits
  )
  select m.id,
         concat_ws(' ', m.first_name, m.middle_name, m.last_name),
         m.membership_no,
         '••• ' || right(regexp_replace(m.phone, '\D', '', 'g'), 4),
         m.branch_id,
         br.name,
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'id', p.id, 'plan_name', pt.name, 'start_date', p.start_date, 'maturity_date', p.maturity_date,
                    'contribution_amount', p.contribution_amount, 'contribution_frequency', p.contribution_frequency
                  ) order by p.start_date desc)
             from public.member_plans p
             join public.plan_types pt on pt.code = p.plan_type
            where p.member_id = m.id and p.status = 'active'
         ), '[]'::jsonb)
    from public.members m
    join public.branches br on br.id = m.branch_id
    cross join q
   where length(q.text) >= 2
     and m.status = 'approved'
     and app.has_branch_permission('accounts.receipts.record', m.branch_id)
     and (
       -- every word of the query appears in the name or membership number
       not exists (
         select 1 from unnest(string_to_array(q.text, ' ')) w
          where w <> ''
            and position(w in lower(concat_ws(' ', m.first_name, m.middle_name, m.last_name, m.membership_no))) = 0
       )
       -- or a phone number was typed and it matches (ignoring spaces, dashes and a leading +234 / 0)
       or (
         q.text ~ '^[0-9 +()-]+$'
         and length(q.digits) >= 4
         and position(
               right(q.digits, least(length(q.digits), 10))
               in regexp_replace(m.phone, '\D', '', 'g')
             ) > 0
       )
     )
   order by m.last_name, m.first_name
   limit 20;
$$;

revoke all on function public.top_up_member_search(text) from public, anon;
grant execute on function public.top_up_member_search(text) to authenticated;

-- initiate_top_up gains the member and plan Accounts picked. The old signature is replaced.
drop function public.initiate_top_up(uuid, uuid, numeric, date, text, text, uuid, text, text);

create or replace function public.initiate_top_up(
  p_id uuid, p_branch_id uuid, p_amount numeric, p_paid_on date, p_payment_method text, p_reference text,
  p_bank_account_id uuid, p_paid_by text, p_note text, p_member_id uuid default null, p_member_plan_id uuid default null
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
      requested_by, requested_at, matched_member_id, matched_plan_id
    ) values (
      'TOP-' || lpad(nextval('public.top_up_no_seq')::text, 6, '0'), p_branch_id, p_amount, p_paid_on, p_payment_method,
      nullif(trim(coalesce(p_reference, '')), ''), p_bank_account_id, trim(p_paid_by), nullif(trim(coalesce(p_note, '')), ''),
      'with_branch', auth.uid(), now(), p_member_id, p_member_plan_id
    ) returning * into v_row;
  else
    update public.top_up_requests
       set branch_id = p_branch_id, amount = p_amount, paid_on = p_paid_on, payment_method = p_payment_method,
           reference = nullif(trim(coalesce(p_reference, '')), ''), bank_account_id = p_bank_account_id,
           paid_by = trim(p_paid_by), note = nullif(trim(coalesce(p_note, '')), ''), status = 'with_branch',
           requested_by = auth.uid(), requested_at = now(), matched_member_id = p_member_id, matched_plan_id = p_member_plan_id
     where id = p_id
     returning * into v_row;
  end if;
  perform app.end_workflow();
  return v_row;
end;
$$;

revoke all on function public.initiate_top_up(uuid, uuid, numeric, date, text, text, uuid, text, text, uuid, uuid) from public, anon;
grant execute on function public.initiate_top_up(uuid, uuid, numeric, date, text, text, uuid, text, text, uuid, uuid) to authenticated;

-- top_up_list also returns who Accounts matched it to.
drop function public.top_up_list(text[]);

create or replace function public.top_up_list(p_statuses text[] default null)
returns table (
  id uuid, top_up_no text, branch_id uuid, branch_name text, amount numeric, paid_on date, payment_method text,
  reference text, bank_account_id uuid, bank_account_name text, paid_by text, note text, status text,
  requested_by uuid, requested_by_name text, requested_at timestamptz,
  member_id uuid, member_name text, membership_no text, member_plan_id uuid, plan_name text, contribution_id uuid,
  contribution_verified boolean, contribution_status text, logged_by_name text, logged_at timestamptz,
  decided_by_name text, decided_at timestamptz, decision_note text,
  matched_member_id uuid, matched_member_name text, matched_membership_no text, matched_plan_id uuid, matched_plan_name text
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
         r.matched_plan_id, mpt.name
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
