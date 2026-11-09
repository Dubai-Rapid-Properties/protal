-- ============================================================================
-- D|R|P PMS - 0067 Videos on repairs, complaints and guest incidents
--
-- Staff (and owners, on their own tickets) can add short videos next to the
-- photos. A video sits in the same list as the photos (photo_paths, up to 12
-- in all) under ticket/<id>/ or incident/<id>/ in the private documents
-- bucket, and is told apart by its extension (.mp4, .mov, .webm).
--
-- A video is too big to pass through the portal, so the browser uploads it
-- straight to storage with a one-time signed link the server issues after
-- checking the person may add to that ticket or incident.
--
-- The documents bucket now accepts MP4, MOV (iPhone) and WebM, and files up
-- to 50 MB (about a minute of phone video; also Supabase's default upload
-- limit per file).
-- ============================================================================

update storage.buckets
   set allowed_mime_types = (
         select array_agg(distinct t)
           from unnest(coalesce(allowed_mime_types, '{}') || array['video/mp4', 'video/quicktime', 'video/webm']) as t
       ),
       file_size_limit = greatest(coalesce(file_size_limit, 0), 52428800)
 where id = 'documents';
