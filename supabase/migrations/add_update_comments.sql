-- 进度评论表：任何已登录成员可对进度记录发表评论
CREATE TABLE IF NOT EXISTS public.issue_update_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  update_id UUID NOT NULL REFERENCES public.issue_updates (id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_update_comments_update ON public.issue_update_comments (update_id);
CREATE INDEX idx_update_comments_created ON public.issue_update_comments (created_at);

ALTER TABLE public.issue_update_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "update_comments_select_authenticated"
  ON public.issue_update_comments FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "update_comments_insert_authenticated"
  ON public.issue_update_comments FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "update_comments_delete_own_or_admin"
  ON public.issue_update_comments FOR DELETE
  TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());
