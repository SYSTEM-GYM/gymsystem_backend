-- Anamnesis: admin-recorded medical observations, injuries, restrictions
ALTER TABLE public.users
  ADD COLUMN medical_notes TEXT;
