-- 附件表：支持问题级附件（issue_update_id 为空）和进展级附件（issue_update_id 非空）

CREATE TABLE public.issue_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id UUID NOT NULL REFERENCES public.issues (id) ON DELETE CASCADE,
  issue_update_id UUID REFERENCES public.issue_updates (id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  size_bytes BIGINT NOT NULL DEFAULT 0,
  uploaded_by UUID NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_attachments_issue ON public.issue_attachments (issue_id);
CREATE INDEX idx_attachments_update ON public.issue_attachments (issue_update_id);

ALTER TABLE public.issue_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "attachments_select_authenticated"
  ON public.issue_attachments FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "attachments_insert_authenticated"
  ON public.issue_attachments FOR INSERT
  TO authenticated
  WITH CHECK (uploaded_by = auth.uid());

CREATE POLICY "attachments_delete_own_or_admin"
  ON public.issue_attachments FOR DELETE
  TO authenticated
  USING (uploaded_by = auth.uid() OR public.is_admin());

-- Supabase Storage bucket 需在控制台手动创建（名称: issue-files，设为 private）。
-- 然后在 Storage → Policies 中添加如下策略：
--
-- SELECT（已登录用户可下载）:
--   auth.role() = 'authenticated'
--
-- INSERT（已登录用户可上传，路径必须以 issue_id 开头）:
--   auth.role() = 'authenticated'
--
-- DELETE（上传者或管理员可删除）:
--   auth.role() = 'authenticated'
