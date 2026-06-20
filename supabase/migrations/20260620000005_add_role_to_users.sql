-- Add role column to differentiate admins, trainers, and customers
ALTER TABLE public.users
  ADD COLUMN role TEXT NOT NULL DEFAULT 'customer'
    CHECK (role IN ('admin', 'trainer', 'customer'));

-- Update the new-user trigger to be explicit about the default role
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.users (id, full_name, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', ''),
    'customer'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;
