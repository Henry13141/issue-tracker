-- Backfill missing reviewer_id with default admin reviewer.
-- Temporary policy: default reviewer is HaoYi admin; if no exact match is found,
-- fall back to the highest-ranked admin by name/email heuristic.

DO $$
DECLARE
  default_reviewer_id UUID;
BEGIN
  SELECT id
  INTO default_reviewer_id
  FROM public.users
  WHERE role = 'admin'
  ORDER BY
    CASE
      WHEN name = '郝毅' THEN 100
      WHEN name ILIKE '%郝毅%' THEN 80
      WHEN email ILIKE 'haoyi@%' THEN 60
      WHEN email ILIKE '%haoyi%' THEN 40
      ELSE 0
    END DESC,
    created_at ASC
  LIMIT 1;

  IF default_reviewer_id IS NULL THEN
    RAISE NOTICE 'backfill skipped: no admin user found.';
    RETURN;
  END IF;

  UPDATE public.issues
  SET reviewer_id = default_reviewer_id
  WHERE reviewer_id IS NULL;
END $$;
