-- Electronic signatures on documents.
--
-- Until now a document was signed on paper, scanned and uploaded. That stays. As an alternative, a document already on
-- file (a member's agreement letter, a loan's application form or offer letter, a guarantor's form) can be signed
-- electronically: the signer draws or types their signature on the staff member's screen, and it is kept with the
-- signer's name and role, who recorded it, when, and a fingerprint (SHA-256) of the document as it was when signed.
-- A guarantor can also sign their guarantee on the guarantor's own record, in place of a paper guarantor's form.
--
-- The signature images live in the private "e-signatures" bucket at <branch_id>/<member|loan>/<id>.png, so access
-- follows the branch and the department, like the documents themselves. Signatures are never edited or removed by
-- hand; they go only with the document (or guarantor) they belong to, and the audit log keeps that history.

create type public.signer_role as enum ('member', 'guarantor', 'staff', 'witness');
create type public.signature_method as enum ('drawn', 'typed');

create table public.e_signatures (
  id uuid primary key default gen_random_uuid(),
  member_document_id uuid references public.member_documents (id) on delete cascade,
  loan_document_id uuid references public.loan_documents (id) on delete cascade,
  loan_guarantor_id uuid references public.loan_guarantors (id) on delete cascade,
  branch_id uuid not null references public.branches (id),
  signer_role public.signer_role not null,
  signer_name text not null check (length(btrim(signer_name)) between 2 and 120),
  -- Set when a staff member signs as themselves.
  signer_staff_id uuid references public.staff (id),
  method public.signature_method not null,
  typed_text text check (typed_text is null or length(btrim(typed_text)) between 2 and 120),
  -- What was signed, written by the database from the document or guarantor at the time of signing.
  statement text not null,
  storage_path text not null unique,
  image_sha256 text not null check (image_sha256 ~ '^[0-9a-f]{64}$'),
  document_sha256 text check (document_sha256 ~ '^[0-9a-f]{64}$'),
  consent_given boolean not null check (consent_given),
  recorded_by uuid not null default auth.uid() references public.staff (id),
  signed_at timestamptz not null default now(),
  check (num_nonnulls(member_document_id, loan_document_id, loan_guarantor_id) = 1),
  check ((method = 'typed') = (typed_text is not null))
);
create index e_signatures_member_document_idx on public.e_signatures (member_document_id) where member_document_id is not null;
create index e_signatures_loan_document_idx on public.e_signatures (loan_document_id) where loan_document_id is not null;
-- A guarantor signs their guarantee once.
create unique index e_signatures_loan_guarantor_idx on public.e_signatures (loan_guarantor_id) where loan_guarantor_id is not null;

create or replace function app.e_signatures_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_branch uuid;
  v_folder text;
  v_member_doc public.member_documents;
  v_loan_doc public.loan_documents;
  v_guarantor public.loan_guarantors;
  v_member public.members;
  v_loan public.loans;
begin
  if tg_op = 'UPDATE' then
    raise exception 'a signature can''t be changed once recorded' using errcode = 'insufficient_privilege';
  end if;

  if new.member_document_id is not null then
    select * into v_member_doc from public.member_documents where id = new.member_document_id;
    select * into v_member from public.members where id = v_member_doc.member_id;
    v_branch := v_member_doc.branch_id;
    v_folder := 'member';
    if v_member_doc.id is null
       or not (app.has_branch_permission('members.manage', v_branch) or app.has_branch_permission('members.approve', v_branch)) then
      raise exception 'document not found' using errcode = 'no_data_found';
    end if;
    if new.signer_role = 'guarantor' then
      raise exception 'guarantors sign loan documents, not a member''s file' using errcode = 'check_violation';
    end if;
    new.statement := format(
      '%s (%s) on the file of %s %s%s',
      initcap(replace(v_member_doc.document_type::text, '_', ' ')), v_member_doc.file_name,
      v_member.first_name, v_member.last_name, coalesce(', membership no. ' || v_member.membership_no, '')
    );
  elsif new.loan_document_id is not null then
    select * into v_loan_doc from public.loan_documents where id = new.loan_document_id;
    select * into v_loan from public.loans where id = v_loan_doc.loan_id;
    v_branch := v_loan_doc.branch_id;
    v_folder := 'loan';
    if v_loan_doc.id is null
       or not (app.has_branch_permission('credit.manage', v_branch) or app.has_branch_permission('credit.appraise', v_branch)
               or app.has_branch_permission('credit.approve', v_branch)) then
      raise exception 'document not found' using errcode = 'no_data_found';
    end if;
    new.statement := format(
      '%s (%s) for loan %s', initcap(replace(v_loan_doc.document_type::text, '_', ' ')), v_loan_doc.file_name, v_loan.loan_no
    );
  else
    select * into v_guarantor from public.loan_guarantors where id = new.loan_guarantor_id;
    select * into v_loan from public.loans where id = v_guarantor.loan_id;
    select * into v_member from public.members where id = v_loan.member_id;
    v_branch := v_guarantor.branch_id;
    v_folder := 'loan';
    if v_guarantor.id is null
       or not (app.has_branch_permission('credit.manage', v_branch) or app.has_branch_permission('credit.appraise', v_branch)) then
      raise exception 'guarantor not found' using errcode = 'no_data_found';
    end if;
    if v_loan.status not in ('draft', 'returned', 'submitted') then
      raise exception 'guarantors sign before the application is appraised' using errcode = 'check_violation';
    end if;
    if new.signer_role <> 'guarantor' then
      raise exception 'only the guarantor signs their guarantee' using errcode = 'check_violation';
    end if;
    new.signer_name := v_guarantor.full_name;
    new.statement := format(
      'I stand as guarantor for loan %s of %s %s (%s requested, %s months)',
      v_loan.loan_no, v_member.first_name, v_member.last_name,
      to_char(v_loan.amount_requested, 'FM999,999,999,990.00'), v_loan.tenor_months
    );
  end if;

  -- A staff member signs only as themselves, under the name on their login.
  if new.signer_role = 'staff' then
    new.signer_staff_id := auth.uid();
    select s.full_name into new.signer_name from public.staff s where s.id = auth.uid();
  else
    new.signer_staff_id := null;
  end if;

  if new.storage_path not like v_branch::text || '/' || v_folder || '/%.png' then
    raise exception 'signature image must sit under the branch''s % folder', v_folder using errcode = 'check_violation';
  end if;

  new.signer_name := btrim(new.signer_name);
  new.typed_text := nullif(btrim(new.typed_text), '');
  new.branch_id := v_branch;
  new.recorded_by := auth.uid();
  new.signed_at := now();
  return new;
end;
$$;

create trigger e_signatures_guard
  before insert or update on public.e_signatures
  for each row execute function app.e_signatures_guard();

select app.enable_audit('public.e_signatures');

alter table public.e_signatures enable row level security;

create policy "document readers see signatures" on public.e_signatures for select to authenticated
  using (
    (member_document_id is not null and app.has_branch_permission('members.read', branch_id))
    or (member_document_id is null and app.has_branch_permission('credit.read', branch_id))
  );
-- The guard trigger checks the signer may sign this particular document or guarantee.
create policy "staff record signatures" on public.e_signatures for insert to authenticated
  with check (recorded_by = auth.uid());
-- No update or delete policies: a signature is removed only with its document or guarantor.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('e-signatures', 'e-signatures', false, 524288, array['image/png'])
on conflict (id) do nothing;

create policy "document readers view signature images" on storage.objects for select to authenticated
  using (
    bucket_id = 'e-signatures' and (
      ((storage.foldername(name))[2] = 'member' and app.has_branch_permission('members.read', app.storage_path_branch(name)))
      or ((storage.foldername(name))[2] = 'loan' and app.has_branch_permission('credit.read', app.storage_path_branch(name)))
    )
  );

create policy "signers upload signature images" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'e-signatures' and (
      ((storage.foldername(name))[2] = 'member' and (
        app.has_branch_permission('members.manage', app.storage_path_branch(name))
        or app.has_branch_permission('members.approve', app.storage_path_branch(name))
      ))
      or ((storage.foldername(name))[2] = 'loan' and (
        app.has_branch_permission('credit.manage', app.storage_path_branch(name))
        or app.has_branch_permission('credit.appraise', app.storage_path_branch(name))
        or app.has_branch_permission('credit.approve', app.storage_path_branch(name))
      ))
    )
  );
-- No update or delete policies: signature images are kept as evidence.
