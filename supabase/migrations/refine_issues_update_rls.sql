-- 细化 issues 表的 UPDATE 策略
--
-- 原策略 issues_update_authenticated 对所有已登录用户开放 USING(true) WITH CHECK(true)，
-- 允许任意字段被任意已登录用户修改，存在绕过 UI 直接修改 creator_id 等字段的风险。
--
-- 新策略：
--   1. Admin 拥有完整 UPDATE 权限（任意字段、任意行）
--   2. 普通成员可以更新任意工单（保留团队协作能力），
--      但 WITH CHECK 约束 creator_id 不可被改变（防止伪造工单归属）

-- 1. 删除原有过宽策略
DROP POLICY IF EXISTS "issues_update_authenticated" ON public.issues;
DROP POLICY IF EXISTS "issues_update_roles" ON public.issues;

-- 2. Admin 策略：不受限制
CREATE POLICY "issues_update_admin"
  ON public.issues FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- 3. 普通成员策略：可更新任意工单，但 creator_id 不可被篡改
CREATE POLICY "issues_update_member"
  ON public.issues FOR UPDATE
  TO authenticated
  USING (NOT public.is_admin())
  WITH CHECK (
    NOT public.is_admin()
    -- creator_id 必须保持不变（通过子查询取当前存储值对比）
    AND creator_id = (
      SELECT i.creator_id FROM public.issues i WHERE i.id = issues.id
    )
  );
