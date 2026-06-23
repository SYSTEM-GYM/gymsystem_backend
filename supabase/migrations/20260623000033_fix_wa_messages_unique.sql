-- Fix ON CONFLICT support: partial unique index cannot be used with upsert on wa_message_id
DROP INDEX IF EXISTS public.wa_messages_wa_id_unique;

ALTER TABLE public.wa_messages
  DROP CONSTRAINT IF EXISTS wa_messages_wa_message_id_unique;

ALTER TABLE public.wa_messages
  ADD CONSTRAINT wa_messages_wa_message_id_unique UNIQUE (wa_message_id);

NOTIFY pgrst, 'reload schema';
