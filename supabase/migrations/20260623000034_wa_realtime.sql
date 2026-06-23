-- Habilita Supabase Realtime para o CRM WhatsApp
ALTER TABLE public.wa_messages REPLICA IDENTITY FULL;
ALTER TABLE public.wa_contacts REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'wa_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.wa_messages;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'wa_contacts'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.wa_contacts;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
