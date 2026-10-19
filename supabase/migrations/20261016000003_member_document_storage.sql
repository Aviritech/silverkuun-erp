-- Private storage for member KYC documents and signed letters.
-- Files are stored at <branch_id>/<member_id>/<file>, so access follows the member's branch.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('member-documents', 'member-documents', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;

create or replace function app.storage_path_branch(p_name text)
returns uuid
language sql
immutable
as $$
  select case
    when (storage.foldername(p_name))[1] ~ '^[0-9a-f-]{36}$' then (storage.foldername(p_name))[1]::uuid
  end;
$$;

create policy "member readers download member documents" on storage.objects for select to authenticated
  using (bucket_id = 'member-documents' and app.has_branch_permission('members.read', app.storage_path_branch(name)));

create policy "member managers upload member documents" on storage.objects for insert to authenticated
  with check (bucket_id = 'member-documents' and app.has_branch_permission('members.manage', app.storage_path_branch(name)));
-- No update or delete policies: uploaded files are kept as evidence.
