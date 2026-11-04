-- Browsers upload files straight to this bucket, and the server action then reads them from here. Vercel refuses
-- request bodies over 4.5 MB, so a file sent through a server action failed long before our 10 MB limit.
-- Each staff member writes only under a folder named after their own id; the server moves on what it needs and
-- removes the staged copy.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('upload-staging', 'upload-staging', false, 10485760, null)
on conflict (id) do nothing;

create policy "staff stage their own uploads" on storage.objects for insert to authenticated
  with check (bucket_id = 'upload-staging' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "staff read their own staged uploads" on storage.objects for select to authenticated
  using (bucket_id = 'upload-staging' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "staff clear their own staged uploads" on storage.objects for delete to authenticated
  using (bucket_id = 'upload-staging' and (storage.foldername(name))[1] = auth.uid()::text);
