-- Synced asynchronously from the Local Edge Service via syncAccessLogs
CREATE TABLE public.occupancy_logs (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  event_type      TEXT        NOT NULL CHECK (event_type IN ('entry', 'exit')),
  -- QR hash presented at the turnstile (HMAC SHA-256, 10s expiry validated at edge)
  qr_hash         TEXT,
  validated_at    TIMESTAMPTZ NOT NULL,   -- timestamp of local edge validation
  synced_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  turnstile_id    TEXT,                   -- hardware identifier
  notes           TEXT
);

ALTER TABLE public.occupancy_logs ENABLE ROW LEVEL SECURITY;

-- Users can view their own access history
CREATE POLICY "occupancy_logs_select_own" ON public.occupancy_logs
  FOR SELECT USING (auth.uid() = user_id);

-- Only service role syncs logs from edge (POST via cloud backend)
CREATE POLICY "occupancy_logs_insert_service" ON public.occupancy_logs
  FOR INSERT WITH CHECK (auth.role() = 'service_role');

CREATE INDEX idx_occupancy_logs_user_id ON public.occupancy_logs(user_id);
CREATE INDEX idx_occupancy_logs_validated_at ON public.occupancy_logs(validated_at DESC);

-- View for real-time occupancy: current_occupancy = total_entries - total_exits
CREATE VIEW public.current_occupancy AS
SELECT
  COUNT(*) FILTER (WHERE event_type = 'entry') -
  COUNT(*) FILTER (WHERE event_type = 'exit')  AS occupant_count,
  MAX(validated_at)                             AS last_event_at
FROM public.occupancy_logs
WHERE validated_at >= NOW() - INTERVAL '12 hours';
