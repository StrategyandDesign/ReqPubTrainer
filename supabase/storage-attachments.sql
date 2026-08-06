-- ============================================================================
-- ReqPub - Storage bucket + policies for attachments (v2.10.0)
-- ============================================================================
-- Run ONCE in the Supabase SQL editor, AFTER schema.sql (which creates the
-- attachments metadata table and is_org_member/is_org_manager helpers).
--
-- Creates the private 'attachments' bucket and locks it down:
--   • Files are never public; downloads happen only through short-lived signed
--     URLs the app requests.
--   • Only org MEMBERS can read (sign) files under their own org's path.
--   • Only org MANAGERS can delete.
--   • NOBODY can write bytes directly - uploads go through the attachment-upload
--     edge function (service role), which type/size-checks and virus-scans first.
--
-- Storage path convention (set by the edge function):  <org_id>/<project_id>/<uuid>/<filename>
-- so foldername()[1] = org_id, which the policies below authorize against.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit)
values ('attachments', 'attachments', false, 26214400)
on conflict (id) do update set public = false, file_size_limit = 26214400;

-- Read / sign: any member of the org that owns the path.
drop policy if exists attach_obj_read on storage.objects;
create policy attach_obj_read on storage.objects for select to authenticated using (
  bucket_id = 'attachments'
  and public.is_org_member(((storage.foldername(name))[1])::uuid)
);

-- Delete: managers of that org (mirrors the attachments table delete policy).
drop policy if exists attach_obj_delete on storage.objects;
create policy attach_obj_delete on storage.objects for delete to authenticated using (
  bucket_id = 'attachments'
  and public.is_org_manager(((storage.foldername(name))[1])::uuid)
);

-- No INSERT/UPDATE policy for authenticated users on purpose: the only writer is
-- the upload edge function using the service role, so every stored byte has been
-- through the scan path. (The service role bypasses RLS.)
