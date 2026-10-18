-- 0010_bridge.sql — connect edge functions to DB layer
-- Part 1: rename DB-agent submit_complaint to submit_complaint_core

ALTER FUNCTION public.submit_complaint(
  p_title text, p_description text, p_category_id uuid, p_ai_confidence numeric,
  p_urgency urgency_level, p_lat numeric, p_lng numeric, p_region text,
  p_council_area text, p_ward text, p_photo_url text, p_channel report_channel,
  p_citizen_name text, p_citizen_phone text, p_is_anonymous boolean
) RENAME TO submit_complaint_core;
