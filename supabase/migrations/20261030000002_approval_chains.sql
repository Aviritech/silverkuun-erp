-- Approval chains requested by Kuun (22 October 2026):
--
--   1. Member files:  Operations Officer ──▶ Marketer ──▶ Operations Officer ──▶ Branch Manager
--        draft ──send──▶ with_marketer ──review──▶ marketer_reviewed ──submit──▶ pending_approval ──approve──▶ approved
--          ▲                  │                          (officer finishes              │
--          └──── returned ◀───┴───────── return ────────  documents here)  ◀────────────┘
--      The marketer confirms the member and their details. The officer then completes the file (all KYC documents)
--      and sends it to the Branch Manager. A returned file goes round the whole chain again.
--
--   2. Guarantors are confirmed one by one by the credit analyst (not the account officer who added them) before the
--      application can be appraised.
--
--   3. Loans:  Head of Credit ──▶ Head of Business ──▶ Accounts
--        appraised ──Head of Credit approves──▶ credit_approved ──Head of Business approves──▶ approved ──▶ Accounts pays
--      Either can return the application to the officer or reject it.
--
--   4. Every outflow (every Accounts payment, including loan disbursements, salaries and supplier payments) needs
--      Internal Audit's approval after Accounts approves it and before anyone can mark it paid.
--
--   5. Ledger account 5100 is renamed "Interest expense".

-- ===========================================================================
-- 1. Member files: the marketer's review
-- ===========================================================================

insert into public.permissions (code, description) values
  ('members.endorse', 'Review member files as the marketer before the officer sends them to the Branch Manager');

insert into public.roles (code, department_code, name, description) values
  ('marketer', 'administration', 'Marketer', 'Brings in members and confirms their details before the file goes to the Branch Manager');

insert into public.role_permissions (role_code, permission_code) values
  ('marketer', 'module.administration'),
  ('marketer', 'members.read'),
  ('marketer', 'members.endorse');

alter table public.members
  add column sent_to_marketer_by uuid references public.staff (id),
  add column sent_to_marketer_at timestamptz,
  add column marketer_id uuid references public.staff (id),
  add column marketer_reviewed_at timestamptz,
  add column marketer_note text,
  add column returned_by uuid references public.staff (id);

-- The marketer's review and who returned a file are written only by the workflow functions.
create or replace function app.members_marketer_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if app.in_workflow() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.sent_to_marketer_by := null;
    new.sent_to_marketer_at := null;
    new.marketer_id := null;
    new.marketer_reviewed_at := null;
    new.marketer_note := null;
    new.returned_by := null;
  elsif new.sent_to_marketer_by is distinct from old.sent_to_marketer_by
     or new.sent_to_marketer_at is distinct from old.sent_to_marketer_at
     or new.marketer_id is distinct from old.marketer_id
     or new.marketer_reviewed_at is distinct from old.marketer_reviewed_at
     or new.marketer_note is distinct from old.marketer_note
     or new.returned_by is distinct from old.returned_by then
    raise exception 'the marketer''s review is recorded only through the approval workflow' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger members_marketer_guard
  before insert or update on public.members
  for each row execute function app.members_marketer_guard();

-- Unchanged, except that a file with the marketer can't be edited either.
create or replace function app.members_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.date_of_birth is not null and new.date_of_birth >= current_date then
      raise exception 'date of birth must be in the past' using errcode = 'check_violation';
    end if;
    if not app.in_workflow() then
      new.status := 'draft';
      new.membership_no := null;
      new.created_by := auth.uid();
      new.submitted_by := null;
      new.submitted_at := null;
      new.approved_by := null;
      new.approved_at := null;
      new.return_reason := null;
      new.amendment_reason := null;
    end if;
    return new;
  end if;

  if new.date_of_birth is not null and new.date_of_birth >= current_date then
    raise exception 'date of birth must be in the past' using errcode = 'check_violation';
  end if;

  new.updated_at := now();
  if app.in_workflow() then
    return new;
  end if;

  if new.status is distinct from old.status
     or new.membership_no is distinct from old.membership_no
     or new.branch_id is distinct from old.branch_id
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at
     or new.submitted_by is distinct from old.submitted_by
     or new.submitted_at is distinct from old.submitted_at
     or new.approved_by is distinct from old.approved_by
     or new.approved_at is distinct from old.approved_at
     or new.return_reason is distinct from old.return_reason then
    raise exception 'status and approval details change only through the approval workflow'
      using errcode = 'insufficient_privilege';
  end if;

  if old.status = 'pending_approval' then
    raise exception 'this file is with the Branch Manager and can''t be edited until it is returned'
      using errcode = 'check_violation';
  end if;
  if old.status = 'with_marketer' then
    raise exception 'this file is with the marketer and can''t be edited until they send it back'
      using errcode = 'check_violation';
  end if;

  if old.status = 'approved'
     and (new.amendment_reason is null
          or length(trim(new.amendment_reason)) = 0
          or new.amendment_reason is not distinct from old.amendment_reason) then
    raise exception 'changes to an approved member need a reason'
      using errcode = 'check_violation';
  end if;

  if old.status <> 'approved' then
    new.amendment_reason := old.amendment_reason;
  end if;

  return new;
end;
$$;

-- The officer can edit the file again once the marketer sends it back.
drop policy "member managers edit unapproved files" on public.members;
create policy "member managers edit unapproved files" on public.members for update to authenticated
  using (status in ('draft', 'returned', 'marketer_reviewed') and app.has_branch_permission('members.manage', branch_id))
  with check (app.has_branch_permission('members.manage', branch_id));

-- Unchanged, except that documents follow the same rule: no changes while the file is with the marketer.
create or replace function app.member_documents_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.members;
begin
  select * into v_member from public.members where id = coalesce(new.member_id, old.member_id);

  if tg_op = 'DELETE' then
    if v_member.status not in ('draft', 'returned', 'marketer_reviewed') then
      raise exception 'documents can only be removed while the file is with the officer' using errcode = 'check_violation';
    end if;
    return old;
  end if;

  new.branch_id := v_member.branch_id;
  new.uploaded_by := auth.uid();
  new.uploaded_at := now();

  if v_member.status = 'pending_approval' then
    raise exception 'this file is with the Branch Manager; documents can be added once it is returned' using errcode = 'check_violation';
  end if;
  if v_member.status = 'with_marketer' then
    raise exception 'this file is with the marketer; documents can be added once they send it back' using errcode = 'check_violation';
  end if;
  if new.storage_path not like v_member.branch_id::text || '/' || v_member.id::text || '/%' then
    raise exception 'storage path must sit under the member''s folder' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

-- Step 1: the officer sends a new or returned file to the branch's marketers.
create or replace function public.send_member_to_marketer(p_member_id uuid)
returns public.members
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.members;
begin
  select * into v_member from public.members where id = p_member_id for update;
  if not found or not app.has_branch_permission('members.manage', v_member.branch_id) then
    raise exception 'member not found' using errcode = 'no_data_found';
  end if;
  if v_member.status not in ('draft', 'returned') then
    raise exception 'only draft or returned files can be sent to the marketer' using errcode = 'check_violation';
  end if;

  perform app.begin_workflow();
  update public.members
     set status = 'with_marketer', sent_to_marketer_by = auth.uid(), sent_to_marketer_at = now(),
         marketer_id = null, marketer_reviewed_at = null, marketer_note = null,
         submitted_by = null, submitted_at = null, return_reason = null, returned_by = null
   where id = p_member_id
   returning * into v_member;
  perform app.end_workflow();
  return v_member;
end;
$$;

-- Step 2: a marketer for the branch confirms the member and sends the file back to the officer.
create or replace function public.marketer_review_member(p_member_id uuid, p_note text)
returns public.members
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.members;
begin
  select * into v_member from public.members where id = p_member_id for update;
  if not found or not app.has_branch_permission('members.endorse', v_member.branch_id) then
    raise exception 'member not found' using errcode = 'no_data_found';
  end if;
  if v_member.status <> 'with_marketer' then
    raise exception 'only files sent to the marketer can be reviewed' using errcode = 'check_violation';
  end if;
  if auth.uid() in (v_member.created_by, v_member.sent_to_marketer_by) then
    raise exception 'you prepared this file, so another marketer must review it' using errcode = 'insufficient_privilege';
  end if;

  perform app.begin_workflow();
  update public.members
     set status = 'marketer_reviewed', marketer_id = auth.uid(), marketer_reviewed_at = now(),
         marketer_note = nullif(trim(p_note), '')
   where id = p_member_id
   returning * into v_member;
  perform app.end_workflow();
  return v_member;
end;
$$;

-- Step 3: the officer sends the completed file to the Branch Manager. Needs the marketer's review and every KYC document.
create or replace function public.submit_member(p_member_id uuid)
returns public.members
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.members;
  v_missing text[];
begin
  select * into v_member from public.members where id = p_member_id for update;
  if not found or not app.has_branch_permission('members.manage', v_member.branch_id) then
    raise exception 'member not found' using errcode = 'no_data_found';
  end if;
  if v_member.status in ('draft', 'returned') then
    raise exception 'send the file to the marketer first' using errcode = 'check_violation';
  end if;
  if v_member.status <> 'marketer_reviewed' then
    raise exception 'only files the marketer has reviewed can be sent to the Branch Manager' using errcode = 'check_violation';
  end if;

  select array_agg(required.t order by required.t) into v_missing
  from unnest(array['kyc_form', 'nin_slip', 'means_of_id', 'utility_bill']::public.member_document_type[]) as required(t)
  where not exists (
    select 1 from public.member_documents d where d.member_id = p_member_id and d.document_type = required.t
  );
  if v_missing is not null then
    raise exception 'missing required documents: %', array_to_string(v_missing, ', ') using errcode = 'check_violation';
  end if;

  perform app.begin_workflow();
  update public.members
     set status = 'pending_approval', submitted_by = auth.uid(), submitted_at = now(), return_reason = null
   where id = p_member_id
   returning * into v_member;
  perform app.end_workflow();
  return v_member;
end;
$$;

-- Step 4: unchanged, except that the marketer who reviewed the file can't also approve it.
create or replace function public.approve_member(p_member_id uuid, p_signature text)
returns public.members
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.members;
  v_branch_code text;
begin
  select * into v_member from public.members where id = p_member_id for update;
  if not found or not app.has_branch_permission('members.approve', v_member.branch_id) then
    raise exception 'member not found' using errcode = 'no_data_found';
  end if;
  if v_member.status <> 'pending_approval' then
    raise exception 'only files awaiting approval can be approved' using errcode = 'check_violation';
  end if;
  if auth.uid() in (v_member.created_by, v_member.submitted_by, v_member.sent_to_marketer_by) then
    raise exception 'you prepared this file, so someone else must approve it' using errcode = 'insufficient_privilege';
  end if;
  if auth.uid() = v_member.marketer_id then
    raise exception 'you reviewed this file as the marketer, so someone else must approve it' using errcode = 'insufficient_privilege';
  end if;
  if p_signature is null or p_signature !~ '^data:image/png;base64,[A-Za-z0-9+/]+=*$' or length(p_signature) > 200000 then
    raise exception 'sign in the box before approving' using errcode = 'check_violation';
  end if;

  select code into v_branch_code from public.branches where id = v_member.branch_id;

  perform app.begin_workflow();
  update public.members
     set status = 'approved',
         approved_by = auth.uid(),
         approved_at = now(),
         approval_signature = p_signature,
         membership_no = 'KUN-' || v_branch_code || '-' || lpad(nextval('public.membership_number_seq')::text, 6, '0')
   where id = p_member_id
   returning * into v_member;
  perform app.end_workflow();
  return v_member;
end;
$$;

-- The marketer (while reviewing) or the Branch Manager (while approving) sends the file back to the officer.
create or replace function public.return_member(p_member_id uuid, p_reason text)
returns public.members
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.members;
  v_permission text;
begin
  select * into v_member from public.members where id = p_member_id for update;
  if not found then
    raise exception 'member not found' using errcode = 'no_data_found';
  end if;
  v_permission := case v_member.status when 'with_marketer' then 'members.endorse' else 'members.approve' end;
  if not app.has_branch_permission(v_permission, v_member.branch_id) then
    raise exception 'member not found' using errcode = 'no_data_found';
  end if;
  if v_member.status not in ('with_marketer', 'pending_approval') then
    raise exception 'only files with the marketer or awaiting approval can be returned' using errcode = 'check_violation';
  end if;
  if auth.uid() in (v_member.created_by, v_member.submitted_by, v_member.sent_to_marketer_by) then
    raise exception 'you prepared this file, so someone else must review it' using errcode = 'insufficient_privilege';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'say what needs correcting' using errcode = 'check_violation';
  end if;

  perform app.begin_workflow();
  update public.members
     set status = 'returned', return_reason = trim(p_reason), returned_by = auth.uid()
   where id = p_member_id
   returning * into v_member;
  perform app.end_workflow();
  return v_member;
end;
$$;

revoke all on function public.send_member_to_marketer(uuid) from public, anon;
revoke all on function public.marketer_review_member(uuid, text) from public, anon;
grant execute on function public.send_member_to_marketer(uuid) to authenticated;
grant execute on function public.marketer_review_member(uuid, text) to authenticated;

-- ===========================================================================
-- 2. Guarantor confirmation
-- ===========================================================================

alter table public.loan_guarantors
  add column confirmed_by uuid references public.staff (id),
  add column confirmed_at timestamptz,
  add column confirmation_note text;

-- Adding or changing a guarantor clears any confirmation; only confirm_loan_guarantor() records one.
create or replace function app.loan_guarantors_confirmation_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if app.in_workflow() then
    return new;
  end if;
  new.confirmed_by := null;
  new.confirmed_at := null;
  new.confirmation_note := null;
  return new;
end;
$$;

create trigger loan_guarantors_confirmation_guard
  before insert or update on public.loan_guarantors
  for each row execute function app.loan_guarantors_confirmation_guard();

-- Unchanged, except that the workflow may record a confirmation on a submitted application.
create or replace function app.loan_parts_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_loan public.loans;
begin
  if tg_op = 'UPDATE' and app.in_workflow() then
    return new;
  end if;
  select * into v_loan from public.loans where id = coalesce(new.loan_id, old.loan_id);
  if v_loan.status not in ('draft', 'returned') then
    raise exception 'guarantors and collateral change only while the application is a draft or returned' using errcode = 'check_violation';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  if tg_op = 'UPDATE' and new.loan_id is distinct from old.loan_id then
    raise exception 'move it by removing and adding it again' using errcode = 'check_violation';
  end if;
  new.branch_id := v_loan.branch_id;
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
  end if;
  return new;
end;
$$;

-- The credit analyst confirms each guarantor (spoke to them, checked their details) while appraising.
create or replace function public.confirm_loan_guarantor(p_guarantor_id uuid, p_note text)
returns public.loan_guarantors
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_guarantor public.loan_guarantors;
  v_loan public.loans;
begin
  select * into v_guarantor from public.loan_guarantors where id = p_guarantor_id for update;
  if found then
    select * into v_loan from public.loans where id = v_guarantor.loan_id;
  end if;
  if v_guarantor.id is null or not app.has_branch_permission('credit.appraise', v_loan.branch_id) then
    raise exception 'guarantor not found' using errcode = 'no_data_found';
  end if;
  if v_loan.status <> 'submitted' then
    raise exception 'guarantors are confirmed while the application is being appraised' using errcode = 'check_violation';
  end if;
  if auth.uid() in (v_loan.created_by, v_loan.submitted_by, v_loan.account_officer_id, v_guarantor.created_by) then
    raise exception 'you prepared this application, so someone else must confirm its guarantors' using errcode = 'insufficient_privilege';
  end if;
  if v_guarantor.confirmed_at is not null then
    raise exception 'this guarantor is already confirmed' using errcode = 'check_violation';
  end if;
  if p_note is null or length(trim(p_note)) < 5 then
    raise exception 'say how you confirmed the guarantor, for example the call or visit' using errcode = 'check_violation';
  end if;

  perform app.begin_workflow();
  update public.loan_guarantors
     set confirmed_by = auth.uid(), confirmed_at = now(), confirmation_note = trim(p_note)
   where id = p_guarantor_id
   returning * into v_guarantor;
  perform app.end_workflow();
  return v_guarantor;
end;
$$;

revoke all on function public.confirm_loan_guarantor(uuid, text) from public, anon;
grant execute on function public.confirm_loan_guarantor(uuid, text) to authenticated;

-- Unchanged, except that every guarantor must be confirmed first.
create or replace function public.appraise_loan(
  p_loan_id uuid, p_bureau_check text, p_bureau_name text, p_bureau_score text, p_risk_rating text,
  p_recommendation text, p_recommended_amount numeric, p_notes text
)
returns public.loans
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_loan public.loans;
begin
  select * into v_loan from public.loans where id = p_loan_id for update;
  if not found or not app.has_branch_permission('credit.appraise', v_loan.branch_id) then
    raise exception 'loan not found' using errcode = 'no_data_found';
  end if;
  if v_loan.status <> 'submitted' then
    raise exception 'only submitted applications can be appraised' using errcode = 'check_violation';
  end if;
  if auth.uid() in (v_loan.created_by, v_loan.submitted_by, v_loan.account_officer_id) then
    raise exception 'you prepared this application, so someone else must appraise it' using errcode = 'insufficient_privilege';
  end if;
  if exists (select 1 from public.loan_guarantors g where g.loan_id = p_loan_id and g.confirmed_at is null) then
    raise exception 'confirm every guarantor before appraising' using errcode = 'check_violation';
  end if;
  if p_bureau_check is null or p_bureau_check not in ('clear', 'adverse', 'no_record', 'not_checked') then
    raise exception 'record the credit bureau result' using errcode = 'check_violation';
  end if;
  if p_risk_rating is null or p_risk_rating not in ('low', 'medium', 'high') then
    raise exception 'choose a risk rating' using errcode = 'check_violation';
  end if;
  if p_recommendation is null or p_recommendation not in ('approve', 'decline') then
    raise exception 'say whether you recommend approval' using errcode = 'check_violation';
  end if;
  if p_recommendation = 'approve' and (p_recommended_amount is null or p_recommended_amount <= 0 or p_recommended_amount > v_loan.amount_requested) then
    raise exception 'the recommended amount must be above zero and no more than the amount requested' using errcode = 'check_violation';
  end if;
  if p_notes is null or length(trim(p_notes)) < 5 then
    raise exception 'write up the appraisal: capacity to repay, character and security' using errcode = 'check_violation';
  end if;

  perform app.begin_workflow();
  update public.loans
     set status = 'appraised', bureau_check = p_bureau_check, bureau_name = nullif(trim(p_bureau_name), ''),
         bureau_score = nullif(trim(p_bureau_score), ''), risk_rating = p_risk_rating, recommendation = p_recommendation,
         recommended_amount = case when p_recommendation = 'approve' then p_recommended_amount end,
         appraisal_notes = trim(p_notes), appraised_by = auth.uid(), appraised_at = now()
   where id = p_loan_id
   returning * into v_loan;
  perform app.end_workflow();
  return v_loan;
end;
$$;

-- ===========================================================================
-- 3. Loans: Head of Credit, then Head of Business, then Accounts
-- ===========================================================================

insert into public.departments (code, name) values ('management', 'Management');

insert into public.permissions (code, description) values
  ('credit.business_approve', 'Give the Head of Business approval on loans the Head of Credit has approved');

insert into public.roles (code, department_code, name, description) values
  ('head_of_business', 'management', 'Head of Business', 'Gives the final approval on loans after the Head of Credit, before Accounts pays them out');

insert into public.role_permissions (role_code, permission_code) values
  ('head_of_business', 'module.credit'),
  ('head_of_business', 'credit.read'),
  ('head_of_business', 'credit.business_approve'),
  ('head_of_business', 'members.read'),
  ('head_of_business', 'module.administration');

alter table public.loans
  add column business_approved_by uuid references public.staff (id),
  add column business_approved_at timestamptz,
  add column business_note text;

create or replace function app.loans_business_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if app.in_workflow() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.business_approved_by := null;
    new.business_approved_at := null;
    new.business_note := null;
  elsif new.business_approved_by is distinct from old.business_approved_by
     or new.business_approved_at is distinct from old.business_approved_at
     or new.business_note is distinct from old.business_note then
    raise exception 'the Head of Business approval is recorded only through the loan workflow' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger loans_business_guard
  before insert or update on public.loans
  for each row execute function app.loans_business_guard();

-- The Head of Credit's decision. Approving now passes the loan to the Head of Business instead of straight to Accounts.
create or replace function public.decide_loan(p_loan_id uuid, p_approve boolean, p_approved_amount numeric, p_note text)
returns public.loans
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_loan public.loans;
begin
  select * into v_loan from public.loans where id = p_loan_id for update;
  if not found or not app.has_branch_permission('credit.approve', v_loan.branch_id) then
    raise exception 'loan not found' using errcode = 'no_data_found';
  end if;
  if v_loan.status <> 'appraised' then
    raise exception 'only appraised applications can be approved or rejected' using errcode = 'check_violation';
  end if;
  if auth.uid() in (v_loan.created_by, v_loan.submitted_by, v_loan.account_officer_id) then
    raise exception 'you prepared this application, so someone else must decide it' using errcode = 'insufficient_privilege';
  end if;
  if auth.uid() = v_loan.appraised_by then
    raise exception 'you appraised this application, so someone else must decide it' using errcode = 'insufficient_privilege';
  end if;

  perform app.begin_workflow();
  if p_approve then
    if p_approved_amount is null or p_approved_amount <= 0 or p_approved_amount > v_loan.amount_requested then
      raise exception 'the approved amount must be above zero and no more than the amount requested' using errcode = 'check_violation';
    end if;
    update public.loans
       set status = 'credit_approved', approved_amount = p_approved_amount, approval_note = nullif(trim(p_note), ''),
           approved_by = auth.uid(), approved_at = now(), decided_by = auth.uid(), decided_at = now(), decision_reason = null,
           business_approved_by = null, business_approved_at = null, business_note = null
     where id = p_loan_id
     returning * into v_loan;
  else
    if p_note is null or length(trim(p_note)) < 5 then
      raise exception 'give the reason for rejecting the application' using errcode = 'check_violation';
    end if;
    update public.loans
       set status = 'rejected', decision_reason = trim(p_note), decided_by = auth.uid(), decided_at = now()
     where id = p_loan_id
     returning * into v_loan;
  end if;
  perform app.end_workflow();
  return v_loan;
end;
$$;

-- The Head of Business's decision on a loan the Head of Credit approved. Approving sends it to Accounts to pay out.
create or replace function public.business_decide_loan(p_loan_id uuid, p_approve boolean, p_note text)
returns public.loans
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_loan public.loans;
begin
  select * into v_loan from public.loans where id = p_loan_id for update;
  if not found or not app.has_branch_permission('credit.business_approve', v_loan.branch_id) then
    raise exception 'loan not found' using errcode = 'no_data_found';
  end if;
  if v_loan.status <> 'credit_approved' then
    raise exception 'only loans the Head of Credit has approved can go to the Head of Business' using errcode = 'check_violation';
  end if;
  if auth.uid() in (v_loan.created_by, v_loan.submitted_by, v_loan.account_officer_id, v_loan.appraised_by, v_loan.approved_by) then
    raise exception 'you have already worked on this application, so someone else must give the business approval'
      using errcode = 'insufficient_privilege';
  end if;

  perform app.begin_workflow();
  if p_approve then
    update public.loans
       set status = 'approved', business_approved_by = auth.uid(), business_approved_at = now(),
           business_note = nullif(trim(p_note), '')
     where id = p_loan_id
     returning * into v_loan;
  else
    if p_note is null or length(trim(p_note)) < 5 then
      raise exception 'give the reason for rejecting the loan' using errcode = 'check_violation';
    end if;
    update public.loans
       set status = 'rejected', decision_reason = trim(p_note), decided_by = auth.uid(), decided_at = now()
     where id = p_loan_id
     returning * into v_loan;
  end if;
  perform app.end_workflow();
  return v_loan;
end;
$$;

revoke all on function public.business_decide_loan(uuid, boolean, text) from public, anon;
grant execute on function public.business_decide_loan(uuid, boolean, text) to authenticated;

-- Sends an application back to the account officer: by the analyst while appraising, by the Head of Credit at decision,
-- or by the Head of Business at final approval.
create or replace function public.return_loan(p_loan_id uuid, p_reason text)
returns public.loans
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_loan public.loans;
  v_permission text;
begin
  select * into v_loan from public.loans where id = p_loan_id for update;
  if not found then
    raise exception 'loan not found' using errcode = 'no_data_found';
  end if;
  v_permission := case v_loan.status
    when 'submitted' then 'credit.appraise'
    when 'appraised' then 'credit.approve'
    when 'credit_approved' then 'credit.business_approve'
  end;
  if v_permission is null then
    if not (app.has_branch_permission('credit.appraise', v_loan.branch_id)
            or app.has_branch_permission('credit.approve', v_loan.branch_id)
            or app.has_branch_permission('credit.business_approve', v_loan.branch_id)) then
      raise exception 'loan not found' using errcode = 'no_data_found';
    end if;
    raise exception 'only applications being appraised or awaiting a decision can be returned' using errcode = 'check_violation';
  end if;
  if not app.has_branch_permission(v_permission, v_loan.branch_id) then
    if v_loan.status = 'appraised' and app.has_branch_permission('credit.appraise', v_loan.branch_id) then
      raise exception 'this application is with the Head of Credit for a decision' using errcode = 'check_violation';
    end if;
    if v_loan.status = 'credit_approved' and app.has_branch_permission('credit.approve', v_loan.branch_id) then
      raise exception 'this loan is with the Head of Business for approval' using errcode = 'check_violation';
    end if;
    raise exception 'loan not found' using errcode = 'no_data_found';
  end if;
  if auth.uid() in (v_loan.created_by, v_loan.submitted_by) then
    raise exception 'you prepared this application, so someone else must review it' using errcode = 'insufficient_privilege';
  end if;
  if p_reason is null or length(trim(p_reason)) < 5 then
    raise exception 'say what needs correcting' using errcode = 'check_violation';
  end if;

  perform app.begin_workflow();
  update public.loans
     set status = 'returned', decision_reason = trim(p_reason), approved_amount = null, approval_note = null,
         approved_by = null, approved_at = null
   where id = p_loan_id
   returning * into v_loan;
  perform app.end_workflow();
  return v_loan;
end;
$$;

-- ===========================================================================
-- 4. Internal Audit approves every outflow before it is paid
-- ===========================================================================

insert into public.permissions (code, description) values
  ('audit.payments.approve', 'Approve, return or reject payments after Accounts approves them and before they are paid');

insert into public.role_permissions (role_code, permission_code) values
  ('internal_auditor', 'audit.payments.approve');

alter table public.finance_transactions
  add column audited_by uuid references public.staff (id),
  add column audited_at timestamptz;

create index finance_transactions_awaiting_audit_idx on public.finance_transactions (branch_id)
  where direction = 'payment' and status = 'approved' and audited_at is null;

create or replace function app.finance_transactions_audit_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if app.in_workflow() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.audited_by := null;
    new.audited_at := null;
  elsif new.audited_by is distinct from old.audited_by or new.audited_at is distinct from old.audited_at then
    raise exception 'Internal Audit''s approval is recorded only through the payment workflow' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger finance_transactions_audit_guard
  before insert or update on public.finance_transactions
  for each row execute function app.finance_transactions_audit_guard();

create or replace function public.audit_approve_payment(p_id uuid)
returns public.finance_transactions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_txn public.finance_transactions;
begin
  select * into v_txn from public.finance_transactions where id = p_id for update;
  if not found or not app.has_branch_permission('audit.payments.approve', v_txn.branch_id) then
    raise exception 'transaction not found' using errcode = 'no_data_found';
  end if;
  if v_txn.direction <> 'payment' or v_txn.status <> 'approved' or v_txn.audited_at is not null then
    raise exception 'only payments Accounts has approved and Internal Audit hasn''t yet can be audit-approved' using errcode = 'check_violation';
  end if;
  if auth.uid() in (v_txn.created_by, v_txn.submitted_by, v_txn.approved_by) then
    raise exception 'you worked on this payment, so another auditor must approve it' using errcode = 'insufficient_privilege';
  end if;

  perform app.begin_workflow();
  update public.finance_transactions set audited_by = auth.uid(), audited_at = now() where id = p_id returning * into v_txn;
  perform app.end_workflow();
  return v_txn;
end;
$$;

-- Internal Audit sends an approved payment back to Accounts for correction, or rejects it, with a reason.
create or replace function public.audit_decline_payment(p_id uuid, p_outcome text, p_reason text)
returns public.finance_transactions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_txn public.finance_transactions;
begin
  select * into v_txn from public.finance_transactions where id = p_id for update;
  if not found or not app.has_branch_permission('audit.payments.approve', v_txn.branch_id) then
    raise exception 'transaction not found' using errcode = 'no_data_found';
  end if;
  if p_outcome not in ('returned', 'rejected') then
    raise exception 'choose to return or reject' using errcode = 'check_violation';
  end if;
  if v_txn.direction <> 'payment' or v_txn.status <> 'approved' or v_txn.audited_at is not null then
    raise exception 'only payments waiting for Internal Audit can be returned or rejected here' using errcode = 'check_violation';
  end if;
  if auth.uid() in (v_txn.created_by, v_txn.submitted_by, v_txn.approved_by) then
    raise exception 'you worked on this payment, so another auditor must review it' using errcode = 'insufficient_privilege';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'give a reason' using errcode = 'check_violation';
  end if;

  perform app.begin_workflow();
  update public.finance_transactions
     set status = p_outcome::public.finance_status, decision_reason = 'Internal Audit: ' || trim(p_reason)
   where id = p_id
   returning * into v_txn;
  perform app.end_workflow();
  return v_txn;
end;
$$;

revoke all on function public.audit_approve_payment(uuid) from public, anon;
revoke all on function public.audit_decline_payment(uuid, text, text) from public, anon;
grant execute on function public.audit_approve_payment(uuid) to authenticated;
grant execute on function public.audit_decline_payment(uuid, text, text) to authenticated;

-- Unchanged, except that the payment needs Internal Audit's approval first.
create or replace function public.pay_finance_transaction(p_id uuid)
returns public.finance_transactions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_txn public.finance_transactions;
begin
  select * into v_txn from public.finance_transactions where id = p_id for update;
  if not found or not app.has_branch_permission('accounts.payments.pay', v_txn.branch_id) then
    raise exception 'transaction not found' using errcode = 'no_data_found';
  end if;
  if v_txn.direction <> 'payment' or v_txn.status <> 'approved' then
    raise exception 'only approved payments can be marked as paid' using errcode = 'check_violation';
  end if;
  if v_txn.audited_at is null then
    raise exception 'Internal Audit has to approve this payment before it is paid' using errcode = 'check_violation';
  end if;
  if auth.uid() = v_txn.approved_by then
    raise exception 'you approved this payment, so someone else must make it' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from public.finance_attachments a where a.transaction_id = p_id and a.kind = 'payment_proof') then
    raise exception 'attach proof of payment first' using errcode = 'check_violation';
  end if;

  perform app.begin_workflow();
  update public.finance_transactions set paid_by = auth.uid(), paid_at = now() where id = p_id;
  perform app.end_workflow();
  perform app.post_finance_transaction(p_id);

  select * into v_txn from public.finance_transactions where id = p_id;
  return v_txn;
end;
$$;

-- ===========================================================================
-- 5. "ROI expense" is now "Interest expense"
-- ===========================================================================

update public.ledger_accounts
   set name = 'Interest expense', description = 'Interest on members'' contributions recognised as an expense'
 where code = '5100';
