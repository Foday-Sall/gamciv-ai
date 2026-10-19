-- 0010b_wrapper.sql — API-contract submit_complaint wrapper over submit_complaint_core (matches docs/sql-contract.md)
-- input size limits mirror functions/_shared/limits.ts: oversized values are rejected at the DB boundary
CREATE OR REPLACE FUNCTION public.submit_complaint(
  p_title text,
  p_description text,
  p_category_hint text DEFAULT NULL,
  p_urgency_hint text DEFAULT NULL,
  p_lat numeric DEFAULT NULL,
  p_lng numeric DEFAULT NULL,
  p_region text DEFAULT NULL,
  p_council_area text DEFAULT NULL,
  p_ward text DEFAULT NULL,
  p_photo_url text DEFAULT NULL,
  p_channel report_channel DEFAULT 'web',
  p_citizen_name text DEFAULT NULL,
  p_citizen_phone text DEFAULT NULL,
  p_is_anonymous boolean DEFAULT false,
  p_ai_category text DEFAULT NULL,
  p_ai_urgency text DEFAULT NULL,
  p_confidence numeric DEFAULT NULL,
  p_external_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cat_id uuid;
  v_result public.complaints;
  v_inst_code text;
  v_inst_name text;
  v_dept_name text;
  v_sensitive boolean;
  v_final_category text;
  v_final_urgency text;
  v_conf numeric;
BEGIN
  IF p_title IS NOT NULL AND char_length(p_title) > 200 THEN
    RAISE EXCEPTION 'p_title exceeds 200 characters';
  END IF;
  IF char_length(p_description) > 2000 THEN
    RAISE EXCEPTION 'p_description exceeds 2000 characters';
  END IF;
  IF p_photo_url IS NOT NULL AND char_length(p_photo_url) > 500 THEN
    RAISE EXCEPTION 'p_photo_url exceeds 500 characters';
  END IF;
  IF p_citizen_name IS NOT NULL AND char_length(p_citizen_name) > 100 THEN
    RAISE EXCEPTION 'p_citizen_name exceeds 100 characters';
  END IF;
  IF p_citizen_phone IS NOT NULL AND char_length(p_citizen_phone) > 20 THEN
    RAISE EXCEPTION 'p_citizen_phone exceeds 20 characters';
  END IF;
  IF p_external_id IS NOT NULL AND char_length(p_external_id) > 100 THEN
    RAISE EXCEPTION 'p_external_id exceeds 100 characters';
  END IF;
  IF p_category_hint IS NOT NULL AND char_length(p_category_hint) > 100 THEN
    RAISE EXCEPTION 'p_category_hint exceeds 100 characters';
  END IF;
  IF p_ai_category IS NOT NULL AND char_length(p_ai_category) > 100 THEN
    RAISE EXCEPTION 'p_ai_category exceeds 100 characters';
  END IF;

  -- resolve category: p_ai_category (authoritative) else p_category_hint
  v_final_category := COALESCE(p_ai_category, p_category_hint);
  v_final_urgency  := COALESCE(p_ai_urgency, p_urgency_hint, 'normal');

  IF v_final_category IS NOT NULL THEN
    SELECT id INTO v_cat_id FROM public.categories
    WHERE slug = v_final_category OR name ILIKE v_final_category
    LIMIT 1;
  END IF;

  -- external_id dedupe: same GOWA message id -> return existing result
  IF p_external_id IS NOT NULL THEN
    SELECT c.* INTO v_result
    FROM public.complaints c
    WHERE c.external_id = p_external_id
    LIMIT 1;
    IF FOUND THEN
      SELECT i.code, i.name, d.name
      INTO v_inst_code, v_inst_name, v_dept_name
      FROM public.complaints c2
      LEFT JOIN public.institutions i ON i.id = c2.institution_id
      LEFT JOIN public.departments d ON d.id = c2.department_id
      WHERE c2.id = v_result.id;
      RETURN jsonb_build_object(
        'complaint_id', v_result.id,
        'tracking_no', v_result.tracking_no,
        'institution', v_inst_code,
        'institution_name', v_inst_name,
        'department', v_dept_name,
        'expected_response_at', v_result.expected_response_at,
        'confidence', v_result.ai_confidence,
        'sensitive', v_result.is_sensitive,
        'duplicate', true
      );
    END IF;
  END IF;

  v_conf := COALESCE(p_confidence, 0.0);

  v_result := public.submit_complaint_core(
    p_title        => p_title,
    p_description   => p_description,
    p_category_id   => v_cat_id,
    p_ai_confidence => v_conf,
    p_urgency       => v_final_urgency::urgency_level,
    p_lat           => p_lat,
    p_lng           => p_lng,
    p_region        => p_region,
    p_council_area  => p_council_area,
    p_ward          => p_ward,
    p_photo_url     => p_photo_url,
    p_channel       => p_channel,
    p_citizen_name  => p_citizen_name,
    p_citizen_phone => p_citizen_phone,
    p_is_anonymous  => p_is_anonymous
  );

  UPDATE public.complaints
  SET external_id = p_external_id
  WHERE id = v_result.id AND p_external_id IS NOT NULL;

  SELECT i.code, i.name, d.name, COALESCE(cat.is_sensitive, false)
  INTO v_inst_code, v_inst_name, v_dept_name, v_sensitive
  FROM public.complaints c
  LEFT JOIN public.institutions i ON i.id = c.institution_id
  LEFT JOIN public.departments d ON d.id = c.department_id
  LEFT JOIN public.categories cat ON cat.id = c.category_id
  WHERE c.id = v_result.id;

  RETURN jsonb_build_object(
    'complaint_id', v_result.id,
    'tracking_no', v_result.tracking_no,
    'institution', v_inst_code,
    'institution_name', v_inst_name,
    'department', v_dept_name,
    'expected_response_at', v_result.expected_response_at,
    'confidence', v_conf,
    'sensitive', v_sensitive,
    'duplicate', false
  );
END;
$$;
