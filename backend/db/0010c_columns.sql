-- 0010c_columns.sql — schema additions for edge-function integration

-- external_id: GOWA message id for idempotent intake
ALTER TABLE public.complaints ADD COLUMN IF NOT EXISTS external_id text;
CREATE UNIQUE INDEX IF NOT EXISTS ux_complaints_external_id
  ON public.complaints (external_id) WHERE external_id IS NOT NULL;

-- 'sending' status for the claim handoff
ALTER TYPE public.notif_status ADD VALUE IF NOT EXISTS 'sending' AFTER 'pending';

-- delivery bookkeeping on notifications
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS provider_ref text;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS error text;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;
