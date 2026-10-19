-- 0010d_notify.sql — claim/result functions for the notify-out edge function.

CREATE OR REPLACE FUNCTION public.notify_out_claim(p_notification_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v public.notifications%ROWTYPE;
BEGIN
  SELECT * INTO v FROM public.notifications
  WHERE id::text = p_notification_id
    AND status = 'pending'
  FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  UPDATE public.notifications
  SET status = 'sending', attempts = attempts + 1
  WHERE id = v.id;

  RETURN jsonb_build_object(
    'notification_id', v.id::text,
    'channel', v.channel::text,
    'recipient', v.recipient,
    'message', v.message
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_out_result(
  p_notification_id text,
  p_status text,
  p_provider_ref text DEFAULT NULL,
  p_error text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_status NOT IN ('sent','failed') THEN
    RETURN false;
  END IF;

  UPDATE public.notifications
  SET status = p_status::notif_status,
      provider_ref = p_provider_ref,
      error = p_error,
      sent_at = CASE WHEN p_status = 'sent' THEN now() ELSE sent_at END
  WHERE id::text = p_notification_id
    AND status = 'sending';

  RETURN FOUND;
END;
$$;

CREATE OR REPLACE VIEW public.pending_notifications AS
SELECT id::text AS notification_id, channel::text AS channel,
       recipient, message, attempts, created_at
FROM public.notifications
WHERE status = 'pending'
ORDER BY created_at;
