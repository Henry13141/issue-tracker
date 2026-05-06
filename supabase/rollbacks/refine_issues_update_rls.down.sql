-- 回滚：refine_issues_update_rls.sql
-- 将 issues 的 UPDATE RLS 策略恢复为所有已登录用户可更新（宽松策略）。
--
-- ⚠️ 安全警告：宽松策略允许任意已登录用户修改所有字段（包括 creator_id），
-- 仅在紧急回滚时临时使用，应尽快重新部署细化策略。

-- 1. 删除细化策略
DROP POLICY IF EXISTS "issues_update_admin" ON public.issues;
DROP POLICY IF EXISTS "issues_update_member" ON public.issues;

-- 2. 恢复原来的宽松策略
CREATE POLICY "issues_update_authenticated"
  ON public.issues FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);
