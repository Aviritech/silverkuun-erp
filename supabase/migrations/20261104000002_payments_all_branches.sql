-- Payments Accountants see and pay payment requests from every branch.
--
-- Until now a Payments Accountant only saw the payment requests of the branch
-- (or region) their role was assigned to. Kuun's Payments desk pays for the
-- whole organisation, so the role gets a new permission that lifts the branch
-- limit for payment requests only. Receipts, journals, reconciliations and
-- raising new requests keep their branch limits.

insert into public.permissions (code, description) values
  ('accounts.payments.all_branches', 'See and pay payment requests from every branch, not just your own')
on conflict (code) do nothing;

insert into public.role_permissions (role_code, permission_code) values
  ('payments_accountant', 'accounts.payments.all_branches')
on conflict do nothing;

-- True when the storage path sits in a payment request's evidence folder
-- (<branch id>/<transaction id>/<file>). Used by the storage policies below.
create or replace function app.storage_path_is_payment(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when (storage.foldername(p_name))[2] ~ '^[0-9a-f-]{36}$' then exists (
      select 1 from public.finance_transactions t
       where t.id = (storage.foldername(p_name))[2]::uuid
         and t.branch_id = app.storage_path_branch(p_name)
         and t.direction = 'payment'
    )
    else false
  end;
$$;

revoke all on function app.storage_path_is_payment(text) from public, anon;
grant execute on function app.storage_path_is_payment(text) to authenticated;

-- See every branch's payment requests, their evidence and the bank account they come out of.
create policy "payments desk reads every branch's payment requests" on public.finance_transactions for select to authenticated
  using (direction = 'payment' and app.has_permission('accounts.payments.all_branches'));

create policy "payments desk reads every branch's payment evidence" on public.finance_attachments for select to authenticated
  using (
    app.has_permission('accounts.payments.all_branches')
    and exists (select 1 from public.finance_transactions t where t.id = transaction_id and t.direction = 'payment')
  );

create policy "payments desk reads every branch's bank accounts" on public.bank_accounts for select to authenticated
  using (app.has_permission('accounts.payments.all_branches'));

-- Attach proof of payment to any branch's approved payment (the attachments
-- trigger still checks the status and the folder).
create policy "payments desk attaches proof of payment in any branch" on public.finance_attachments for insert to authenticated
  with check (
    kind = 'payment_proof'
    and app.has_permission('accounts.payments.all_branches')
    and exists (select 1 from public.finance_transactions t where t.id = transaction_id and t.direction = 'payment')
  );

create policy "payments desk downloads payment evidence in any branch" on storage.objects for select to authenticated
  using (
    bucket_id = 'finance-evidence'
    and app.has_permission('accounts.payments.all_branches')
    and app.storage_path_is_payment(name)
  );

create policy "payments desk uploads proof of payment in any branch" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'finance-evidence'
    and app.has_permission('accounts.payments.all_branches')
    and app.storage_path_is_payment(name)
  );

-- Unchanged, except that the payments desk can pay any branch's payment.
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
  if not found or not (
    app.has_branch_permission('accounts.payments.pay', v_txn.branch_id)
    or (v_txn.direction = 'payment' and app.has_permission('accounts.payments.pay')
        and app.has_permission('accounts.payments.all_branches'))
  ) then
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
