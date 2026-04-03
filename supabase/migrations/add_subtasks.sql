-- Add parent_issue_id to support subtask hierarchy (single-level parent-child)
ALTER TABLE public.issues
  ADD COLUMN IF NOT EXISTS parent_issue_id UUID REFERENCES public.issues (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_issues_parent_issue ON public.issues (parent_issue_id);
