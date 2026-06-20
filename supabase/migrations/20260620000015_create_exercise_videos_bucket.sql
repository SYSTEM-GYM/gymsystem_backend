-- Create public storage bucket for exercise demonstration videos
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'exercise-videos',
  'exercise-videos',
  true,                    -- public: URLs accessible without auth token
  104857600,               -- 100 MB limit per file
  ARRAY['video/webm']
)
ON CONFLICT (id) DO NOTHING;

-- All authenticated users can read/stream exercise videos
CREATE POLICY "exercise_videos_select_authenticated" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'exercise-videos'
    AND auth.role() = 'authenticated'
  );

-- Only admins can upload new exercise videos
CREATE POLICY "exercise_videos_insert_admin" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'exercise-videos'
    AND public.current_user_role() = 'admin'
  );

-- Only admins can overwrite exercise videos
CREATE POLICY "exercise_videos_update_admin" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'exercise-videos'
    AND public.current_user_role() = 'admin'
  );

-- Only admins can delete exercise videos
CREATE POLICY "exercise_videos_delete_admin" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'exercise-videos'
    AND public.current_user_role() = 'admin'
  );
