-- Kuun's own loan forms (asked for on 2026-11-19): the Kuun Asset Loan application and guarantor forms, the Payday loan
-- form and checklist, and the Property-backed loan form and checklist.
--
--   1. Three loan products tied to those forms. The existing "Asset finance" product becomes the Kuun Asset Loan, and
--      Payday and Property-backed loans are added. Each product names the paper form it follows
--      (loan_products.application_form), how many guarantors it needs, and the repayment frequencies it allows
--      (weekly or monthly for asset loans, monthly for payday and property-backed loans, as the forms say).
--      Interest rates, limits and tenors are PLACEHOLDERS: none of the forms give them, so Kuun must confirm them.
--   2. The extra details each form asks for (BVN, marital status, next of kin, rent expiry, Remita or direct debit
--      reference, the asset being financed, the guarantor's income and bank, the property they pledge ...) are kept on
--      the application and on each guarantor as form_details. The app checks them against the form; the database
--      keeps them to a JSON object of reasonable size, and they change only while the application is a draft or
--      returned, like the rest of the application.
--   3. The compliance checklist. While appraising, the credit analyst (not the officer who prepared the application)
--      ticks each document on the product's checklist Yes or No with a remark, and records how the customer was
--      verified (asset loans). The application can't be appraised until every required line is Yes; anything missing
--      goes back to the account officer. Sending the application again clears the checklist so it is redone.
--   4. More document types to upload against those lines (utility bill, ID, passport photograph, mandates ...).
--
-- Not changed here, and open for Kuun (see the pull request): the payday form's 6% daily default fee and the
-- property-backed form's 12%-of-principal default interest (late penalties stay at the per-product daily rate), the
-- processing fee and insurance premium, the 40% equity contribution on asset loans (captured and shown, not
-- enforced), and the Compliance, Branch Manager, Marketing Manager and Director sign-offs on the forms, which are not
-- steps in the loan approval chain.
--
-- New enum values can't be used in the transaction that adds them, so nothing below names them as enum literals.
-- Safe to run more than once.

-- ---------------------------------------------------------------------------
-- 1. Products
-- ---------------------------------------------------------------------------

alter table public.loan_products
  add column if not exists application_form text not null default 'standard'
    check (application_form in ('standard', 'kuun_asset', 'payday', 'property_backed')),
  add column if not exists min_guarantors integer not null default 1 check (min_guarantors between 1 and 5),
  add column if not exists repayment_frequencies text[]
    check (repayment_frequencies is null or repayment_frequencies <@ array['weekly', 'monthly', 'quarterly', 'end_of_term']);

comment on column public.loan_products.application_form is
  'The paper form the product follows: standard, or one of Kuun''s forms (kuun_asset, payday, property_backed), which '
  'adds that form''s fields, guarantor form, printable copy and compliance checklist.';
comment on column public.loan_products.min_guarantors is 'Guarantors needed before submitting, when the product requires guarantors.';
comment on column public.loan_products.repayment_frequencies is 'Repayment frequencies allowed; null allows all.';

-- The Kuun Asset Loan replaces the generic asset finance product (same code, so existing loans keep their product).
-- PLACEHOLDER rates, limits and tenors until Kuun confirms them.
update public.loan_products
   set name = 'Kuun Asset Loan',
       description = 'Own it now, live better, pay with ease: housing, appliances, furniture, solar, cars and other approved assets, against a proforma invoice',
       application_form = 'kuun_asset',
       repayment_frequencies = array['weekly', 'monthly'],
       interest_method = 'flat',
       rate_basis = 'per_month',
       requires_proforma = true,
       requires_guarantor = true
 where code = 'asset';

insert into public.loan_products
  (code, name, description, interest_rate, rate_basis, interest_method, min_amount, max_amount, max_tenor_months,
   requires_guarantor, requires_collateral, requires_proforma, sort_order, application_form, min_guarantors, repayment_frequencies)
values
  ('payday', 'Payday loan', 'For salary earners, repaid monthly from salary through Remita, with two guarantors',
   5, 'per_month', 'flat', 20000, 1000000, 6, true, false, false, 35, 'payday', 2, array['monthly']),
  ('property_backed', 'Property-backed loan', 'For business owners, secured on property and assets, repaid monthly by direct debit',
   4, 'per_month', 'flat', 100000, 20000000, 12, true, true, false, 36, 'property_backed', 1, array['monthly'])
on conflict (code) do update
  set application_form = excluded.application_form,
      min_guarantors = excluded.min_guarantors,
      repayment_frequencies = excluded.repayment_frequencies;

-- ---------------------------------------------------------------------------
-- 2. Form details on applications and guarantors
-- ---------------------------------------------------------------------------

alter table public.loans
  add column if not exists form_details jsonb not null default '{}'::jsonb
    check (jsonb_typeof(form_details) = 'object' and length(form_details::text) <= 20000);
alter table public.loan_guarantors
  add column if not exists form_details jsonb not null default '{}'::jsonb
    check (jsonb_typeof(form_details) = 'object' and length(form_details::text) <= 20000);

comment on column public.loans.form_details is 'The extra answers on the product''s Kuun application form (see the app''s loan form fields).';
comment on column public.loan_guarantors.form_details is 'The extra answers on the product''s Kuun guarantor form.';

-- ---------------------------------------------------------------------------
-- 4. Document types (before 3, which names them as text)
-- ---------------------------------------------------------------------------

alter type public.loan_document_type add value if not exists 'utility_bill';
alter type public.loan_document_type add value if not exists 'id_document';
alter type public.loan_document_type add value if not exists 'passport_photo';
alter type public.loan_document_type add value if not exists 'employment_letter';
alter type public.loan_document_type add value if not exists 'direct_debit_mandate';
alter type public.loan_document_type add value if not exists 'guarantor_id';
alter type public.loan_document_type add value if not exists 'guarantor_mandate';
alter type public.loan_document_type add value if not exists 'mortgage_deed';
alter type public.loan_document_type add value if not exists 'cheque_leaves';
alter type public.loan_document_type add value if not exists 'sale_of_assets_agreement';
alter type public.loan_document_type add value if not exists 'insurance_evidence';
alter type public.loan_document_type add value if not exists 'gsi_mandate';
alter type public.loan_document_type add value if not exists 'equity_evidence';

-- ---------------------------------------------------------------------------
-- 3. Compliance checklists
-- ---------------------------------------------------------------------------

-- The lines of each form's checklist, as printed on Kuun's forms. The app keeps the same list in
-- src/modules/credit/loan-forms.ts; change both together.
create table if not exists public.loan_checklist_lines (
  application_form text not null check (application_form in ('kuun_asset', 'payday', 'property_backed')),
  item_code text not null check (item_code ~ '^[a-z][a-z0-9_]*$'),
  label text not null,
  -- The upload that evidences the line, if any (a loan_document_type value, kept as text).
  document_type text,
  required boolean not null default true,
  sort_order integer not null,
  primary key (application_form, item_code)
);

insert into public.loan_checklist_lines (application_form, item_code, label, document_type, required, sort_order) values
  -- PAYDAY LOAN COMPLIANCE CHECKLIST
  ('payday', 'signed_loan_form', 'Signed loan form', 'application_form', true, 10),
  ('payday', 'utility_bill', 'Utility bill', 'utility_bill', true, 20),
  ('payday', 'employment_letter', 'Employment letter', 'employment_letter', true, 30),
  ('payday', 'valid_id', 'Valid ID & Work ID', 'id_document', true, 40),
  ('payday', 'passport', 'Passport photograph', 'passport_photo', true, 50),
  ('payday', 'statement_6m', '6 months statement of account', 'bank_statement', true, 60),
  ('payday', 'credit_bureau', 'Credit bureau check', 'credit_bureau_report', true, 70),
  ('payday', 'direct_debit', 'Direct debit mandate', 'direct_debit_mandate', true, 80),
  ('payday', 'guarantor_id', 'Guarantors ID & Passport', 'guarantor_id', true, 90),
  ('payday', 'guarantor_direct_debit', 'Direct debit mandate (Guarantor)', 'guarantor_mandate', true, 100),
  ('payday', 'two_guarantors', 'Two guarantors', null, true, 110),
  -- PROPERTY-BACKED LOAN COMPLIANCE CHECKLIST
  ('property_backed', 'signed_form_letter', 'Signed loan form & Application letter', 'application_form', true, 10),
  ('property_backed', 'utility_bill', 'Utility bill', 'utility_bill', true, 20),
  ('property_backed', 'valid_id', 'Valid ID', 'id_document', true, 30),
  ('property_backed', 'passport', 'Passport photograph', 'passport_photo', true, 40),
  ('property_backed', 'statement_12m', '12 months statement of account', 'bank_statement', true, 50),
  ('property_backed', 'credit_bureau', 'Credit bureau check', 'credit_bureau_report', true, 60),
  ('property_backed', 'direct_debit', 'Direct debit mandate (customer)', 'direct_debit_mandate', true, 70),
  ('property_backed', 'guarantor_id', 'Guarantors ID & Passport', 'guarantor_id', true, 80),
  ('property_backed', 'guarantor_direct_debit', 'Direct debit mandate (Guarantor)', 'guarantor_mandate', true, 90),
  ('property_backed', 'mortgage_deed', 'Signed Deed of legal mortgage', 'mortgage_deed', true, 100),
  ('property_backed', 'cheque_leaves', 'Cheque leaf(ves)', 'cheque_leaves', true, 110),
  ('property_backed', 'sale_of_assets', 'Sale of Assets Agreement', 'sale_of_assets_agreement', true, 120),
  ('property_backed', 'credit_memo', 'Credit Assessment Memorandum', null, true, 130),
  -- KUUN ASSET LOAN: the form's required attachments (section 05)
  ('kuun_asset', 'loan_form', 'Loan form', 'application_form', true, 10),
  ('kuun_asset', 'passport', 'Recent passport photograph', 'passport_photo', true, 20),
  ('kuun_asset', 'valid_id', 'Valid ID', 'id_document', true, 30),
  ('kuun_asset', 'utility_bill', 'Utility bill', 'utility_bill', true, 40),
  ('kuun_asset', 'bank_statement', 'Bank statement', 'bank_statement', true, 50),
  ('kuun_asset', 'proforma', 'Proforma invoice', 'proforma_invoice', true, 60),
  ('kuun_asset', 'insurance', 'Insurance evidence', 'insurance_evidence', true, 70),
  ('kuun_asset', 'repayment_cheques', 'Repayment cheques', 'cheque_leaves', true, 80),
  ('kuun_asset', 'gsi', 'GSI (Global Standing Instruction)', 'gsi_mandate', true, 90),
  ('kuun_asset', 'guarantor_form', 'Guarantor form', 'guarantor_form', true, 100),
  ('kuun_asset', 'equity', 'Evidence of equity contribution (where applicable)', 'equity_evidence', false, 110)
on conflict (application_form, item_code) do update
  set label = excluded.label, document_type = excluded.document_type, required = excluded.required, sort_order = excluded.sort_order;

-- The analyst's review of one application: how the customer was verified, and who did the checklist.
create table if not exists public.loan_compliance_reviews (
  loan_id uuid primary key references public.loans (id) on delete restrict,
  branch_id uuid not null references public.branches (id),
  verification_methods text[] not null default '{}'
    check (verification_methods <@ array['physical_visit', 'telephone', 'employer_confirmation', 'bank_statement_review', 'other']),
  kyc_status text check (kyc_status in ('satisfactory', 'unsatisfactory')),
  kyc_recommendation text check (kyc_recommendation in ('proceed', 'deferred', 'decline')),
  note text check (note is null or length(note) <= 1000),
  reviewed_by uuid not null references public.staff (id),
  reviewed_at timestamptz not null default now()
);

-- One answer per checklist line.
create table if not exists public.loan_checklist_items (
  loan_id uuid not null references public.loans (id) on delete restrict,
  item_code text not null,
  branch_id uuid not null references public.branches (id),
  answer text not null check (answer in ('yes', 'no', 'not_applicable')),
  remark text check (remark is null or length(remark) <= 300),
  checked_by uuid not null references public.staff (id),
  checked_at timestamptz not null default now(),
  primary key (loan_id, item_code)
);

alter table public.loan_checklist_lines enable row level security;
alter table public.loan_compliance_reviews enable row level security;
alter table public.loan_checklist_items enable row level security;

drop policy if exists "staff read checklist lines" on public.loan_checklist_lines;
drop policy if exists "credit staff read compliance reviews" on public.loan_compliance_reviews;
drop policy if exists "credit staff read checklist answers" on public.loan_checklist_items;
create policy "staff read checklist lines" on public.loan_checklist_lines for select to authenticated using (true);
create policy "credit staff read compliance reviews" on public.loan_compliance_reviews for select to authenticated
  using (app.has_branch_permission('credit.read', branch_id));
create policy "credit staff read checklist answers" on public.loan_checklist_items for select to authenticated
  using (app.has_branch_permission('credit.read', branch_id));
-- No insert, update or delete policies: answers are written only by record_loan_checklist().

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'audit_log_changes' and tgrelid = 'public.loan_compliance_reviews'::regclass) then
    perform app.enable_audit('public.loan_compliance_reviews');
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'audit_log_changes' and tgrelid = 'public.loan_checklist_items'::regclass) then
    perform app.enable_audit('public.loan_checklist_items');
  end if;
end;
$$;

-- Records the checklist for a submitted application. p_items is [{"item": "utility_bill", "answer": "yes",
-- "remark": "..."}, ...] and must answer every line of the product's checklist; it replaces any earlier answers.
create or replace function public.record_loan_checklist(
  p_loan_id uuid, p_items jsonb, p_verification_methods text[], p_kyc_status text, p_kyc_recommendation text, p_note text
)
returns public.loan_compliance_reviews
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_loan public.loans;
  v_form text;
  v_line record;
  v_item jsonb;
  v_answer text;
  v_review public.loan_compliance_reviews;
begin
  select * into v_loan from public.loans where id = p_loan_id for update;
  if not found or not app.has_branch_permission('credit.appraise', v_loan.branch_id) then
    raise exception 'loan not found' using errcode = 'no_data_found';
  end if;
  if v_loan.status <> 'submitted' then
    raise exception 'the checklist is done while the application is being appraised' using errcode = 'check_violation';
  end if;
  if auth.uid() in (v_loan.created_by, v_loan.submitted_by, v_loan.account_officer_id) then
    raise exception 'you prepared this application, so someone else must do its compliance checklist' using errcode = 'insufficient_privilege';
  end if;
  select application_form into v_form from public.loan_products where code = v_loan.product_code;
  if v_form = 'standard' then
    raise exception 'this loan product has no compliance checklist' using errcode = 'check_violation';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'answer every line of the checklist' using errcode = 'check_violation';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_items) e
    where not exists (select 1 from public.loan_checklist_lines l where l.application_form = v_form and l.item_code = e ->> 'item')
  ) then
    raise exception 'the checklist has a line this product doesn''t use' using errcode = 'check_violation';
  end if;
  if p_kyc_status is not null and p_kyc_status not in ('satisfactory', 'unsatisfactory') then
    raise exception 'choose the KYC verification status' using errcode = 'check_violation';
  end if;
  if p_kyc_recommendation is not null and p_kyc_recommendation not in ('proceed', 'deferred', 'decline') then
    raise exception 'choose the KYC recommendation' using errcode = 'check_violation';
  end if;

  delete from public.loan_checklist_items where loan_id = p_loan_id;
  for v_line in select * from public.loan_checklist_lines where application_form = v_form order by sort_order loop
    select e into v_item from jsonb_array_elements(p_items) e where e ->> 'item' = v_line.item_code limit 1;
    v_answer := v_item ->> 'answer';
    if v_answer is null or v_answer not in ('yes', 'no', 'not_applicable') then
      raise exception 'answer "%" on the checklist', v_line.label using errcode = 'check_violation';
    end if;
    if v_answer = 'not_applicable' and v_line.required then
      raise exception '"%" applies to every application: answer Yes or No', v_line.label using errcode = 'check_violation';
    end if;
    if v_answer = 'no' and length(trim(coalesce(v_item ->> 'remark', ''))) < 3 then
      raise exception 'say what is missing for "%"', v_line.label using errcode = 'check_violation';
    end if;
    insert into public.loan_checklist_items (loan_id, item_code, branch_id, answer, remark, checked_by)
    values (p_loan_id, v_line.item_code, v_loan.branch_id, v_answer, nullif(left(trim(coalesce(v_item ->> 'remark', '')), 300), ''), auth.uid());
  end loop;

  insert into public.loan_compliance_reviews
    (loan_id, branch_id, verification_methods, kyc_status, kyc_recommendation, note, reviewed_by, reviewed_at)
  values
    (p_loan_id, v_loan.branch_id, coalesce(p_verification_methods, '{}'), p_kyc_status, p_kyc_recommendation,
     nullif(left(trim(coalesce(p_note, '')), 1000), ''), auth.uid(), now())
  on conflict (loan_id) do update
    set verification_methods = excluded.verification_methods, kyc_status = excluded.kyc_status,
        kyc_recommendation = excluded.kyc_recommendation, note = excluded.note,
        reviewed_by = excluded.reviewed_by, reviewed_at = excluded.reviewed_at
  returning * into v_review;
  return v_review;
end;
$$;
revoke all on function public.record_loan_checklist(uuid, jsonb, text[], text, text, text) from public, anon;
grant execute on function public.record_loan_checklist(uuid, jsonb, text[], text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- The product's rules on the application (alongside app.loans_guard)
-- ---------------------------------------------------------------------------

create or replace function app.loans_form_rules_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product public.loan_products;
  v_guarantors integer;
begin
  select * into v_product from public.loan_products where code = new.product_code;

  -- What the officer enters: the repayment frequency must be one the product allows.
  if not app.in_workflow() then
    if v_product.repayment_frequencies is not null and not (new.repayment_frequency = any (v_product.repayment_frequencies)) then
      raise exception '% loans are repaid %', v_product.name,
        array_to_string(array(select case f when 'end_of_term' then 'once at the end' else f end
                              from unnest(v_product.repayment_frequencies) f), ' or ')
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if tg_op <> 'UPDATE' then
    return new;
  end if;

  -- Sending for appraisal: enough guarantors, and the signed form uploaded for the Kuun forms. The checklist starts
  -- again, so an application corrected after being returned is checked afresh.
  if new.status = 'submitted' and old.status in ('draft', 'returned') then
    if v_product.requires_guarantor then
      select count(*) into v_guarantors from public.loan_guarantors where loan_id = new.id;
      if v_guarantors < v_product.min_guarantors then
        raise exception '% loans need % guarantors', v_product.name, v_product.min_guarantors using errcode = 'check_violation';
      end if;
    end if;
    if v_product.application_form <> 'standard'
       and not exists (select 1 from public.loan_documents d where d.loan_id = new.id and d.document_type::text = 'application_form') then
      raise exception 'upload the customer''s signed % application form' , v_product.name using errcode = 'check_violation';
    end if;
    delete from public.loan_checklist_items where loan_id = new.id;
    delete from public.loan_compliance_reviews where loan_id = new.id;
  end if;

  -- Appraising: every required line of the checklist must be Yes.
  if new.status = 'appraised' and old.status = 'submitted' and v_product.application_form <> 'standard' then
    if not exists (select 1 from public.loan_compliance_reviews r where r.loan_id = new.id) then
      raise exception 'do the compliance checklist before appraising' using errcode = 'check_violation';
    end if;
    if exists (
      select 1 from public.loan_checklist_lines l
      left join public.loan_checklist_items i on i.loan_id = new.id and i.item_code = l.item_code
      where l.application_form = v_product.application_form and l.required and i.answer is distinct from 'yes'
    ) then
      raise exception 'every line of the compliance checklist must be Yes before appraising; return the application for what is missing'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists loans_form_rules_guard on public.loans;
create trigger loans_form_rules_guard
  before insert or update on public.loans
  for each row execute function app.loans_form_rules_guard();
