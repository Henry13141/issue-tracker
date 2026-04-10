-- 新增 finance 角色，并将财务行政待办权限切到 role 控制

ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS users_role_check;

ALTER TABLE public.users
  ADD CONSTRAINT users_role_check
  CHECK (role IN ('admin', 'finance', 'member'));

UPDATE public.users
SET role = 'finance'
WHERE role = 'member'
  AND can_access_finance_ops = true;

UPDATE public.users
SET role = 'finance',
    can_access_finance_ops = true
WHERE name = '李梦艳';

CREATE OR REPLACE FUNCTION public.has_finance_ops_access()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.id = auth.uid()
      AND u.role IN ('admin', 'finance')
  );
$$;
