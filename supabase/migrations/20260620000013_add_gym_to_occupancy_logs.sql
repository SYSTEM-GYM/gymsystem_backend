-- Multi-tenant: track which gym branch the access event occurred at
ALTER TABLE public.occupancy_logs
  ADD COLUMN gym_id UUID REFERENCES public.gyms(id) ON DELETE SET NULL;

-- Update current_occupancy view to support per-gym filtering
DROP VIEW IF EXISTS public.current_occupancy;

CREATE VIEW public.current_occupancy AS
SELECT
  gym_id,
  COUNT(*) FILTER (WHERE event_type = 'entry') -
  COUNT(*) FILTER (WHERE event_type = 'exit')  AS occupant_count,
  MAX(validated_at)                             AS last_event_at
FROM public.occupancy_logs
WHERE validated_at >= NOW() - INTERVAL '12 hours'
GROUP BY gym_id;

CREATE INDEX idx_occupancy_logs_gym_id ON public.occupancy_logs(gym_id);
