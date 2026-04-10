-- 问题列表：已解决 / 已关闭统一排在末尾（在「更新时间」等二级排序之前）
-- 需在 Supabase SQL 编辑器执行，或通过 supabase db push / migrate

ALTER TABLE public.issues
  ADD COLUMN IF NOT EXISTS is_list_terminal boolean
  GENERATED ALWAYS AS (status IN ('resolved', 'closed')) STORED;

COMMENT ON COLUMN public.issues.is_list_terminal IS '列表排序：false=进行中类，true=已解决/已关闭，保证终态行总在列表后部。';

CREATE INDEX IF NOT EXISTS idx_issues_list_terminal_activity
  ON public.issues (is_list_terminal ASC, last_activity_at DESC NULLS LAST)
  WHERE parent_issue_id IS NULL;
