-- Storage bucket for student profile photos captured via admin webcam
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'student-photos',
  'student-photos',
  true,                           -- public: photo_url stored as plain URL in users table
  5242880,                        -- 5 MB per photo
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Admins have full access; students can read their own photo via the public URL
CREATE POLICY "student_photos_select_admin" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'student-photos'
    AND public.current_user_role() = 'admin'
  );

CREATE POLICY "student_photos_insert_admin" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'student-photos'
    AND public.current_user_role() = 'admin'
  );

CREATE POLICY "student_photos_update_admin" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'student-photos'
    AND public.current_user_role() = 'admin'
  );

CREATE POLICY "student_photos_delete_admin" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'student-photos'
    AND public.current_user_role() = 'admin'
  );
