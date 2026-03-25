-- 允许所有已登录成员更新问题（协作改状态、提交进度时同步状态等）。
-- 删除问题仍为仅管理员（issues_delete_admin 不变）。
-- 在 Supabase SQL Editor 中执行本文件，或与 schema.sql 对齐后用于新库。

DROP POLICY IF EXISTS "issues_update_roles" ON public.issues;

CREATE POLICY "issues_update_authenticated"
  ON public.issues FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);
