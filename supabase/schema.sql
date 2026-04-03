-- Internal issue tracker schema for Supabase (PostgreSQL)
-- Run in Supabase SQL Editor after creating a project.

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------------------
-- Profiles linked to auth.users
-- ---------------------------------------------------------------------------
CREATE TABLE public.users (
  id UUID PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  avatar_url TEXT,
  dingtalk_userid TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.issues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'todo'
    CHECK (status IN ('todo', 'in_progress', 'blocked', 'pending_review', 'resolved', 'closed')),
  priority TEXT NOT NULL DEFAULT 'medium'
    CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  assignee_id UUID REFERENCES public.users (id) ON DELETE SET NULL,
  creator_id UUID NOT NULL REFERENCES public.users (id) ON DELETE RESTRICT,
  parent_issue_id UUID REFERENCES public.issues (id) ON DELETE SET NULL,
  due_date DATE,
  resolved_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.issue_updates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id UUID NOT NULL REFERENCES public.issues (id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  status_from TEXT,
  status_to TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id UUID NOT NULL REFERENCES public.issues (id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('no_update_today', 'overdue', 'stale_3_days')),
  message TEXT,
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
CREATE INDEX idx_issues_assignee ON public.issues (assignee_id);
CREATE INDEX idx_issues_status ON public.issues (status);
CREATE INDEX idx_issues_creator ON public.issues (creator_id);
CREATE INDEX idx_issues_due_date ON public.issues (due_date);
CREATE INDEX idx_issues_parent_issue ON public.issues (parent_issue_id);
CREATE INDEX idx_issue_updates_issue ON public.issue_updates (issue_id);
CREATE INDEX idx_issue_updates_created ON public.issue_updates (created_at DESC);
CREATE INDEX idx_reminders_user ON public.reminders (user_id, is_read);
CREATE INDEX idx_reminders_created ON public.reminders (created_at DESC);

-- ---------------------------------------------------------------------------
-- Triggers: updated_at
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER users_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

CREATE TRIGGER issues_updated_at
  BEFORE UPDATE ON public.issues
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Auto-create profile on signup
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.users (id, email, name, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.email, ''),
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1), 'User'),
    COALESCE(NEW.raw_user_meta_data->>'role', 'member')
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

CREATE OR REPLACE FUNCTION public.touch_issue_on_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE public.issues SET updated_at = now() WHERE id = NEW.issue_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER issue_updates_touch_issue
  AFTER INSERT ON public.issue_updates
  FOR EACH ROW EXECUTE PROCEDURE public.touch_issue_on_update();

-- ---------------------------------------------------------------------------
-- Helper: admin check (SECURITY DEFINER to read users row reliably)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.role = 'admin'
  );
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.issue_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reminders ENABLE ROW LEVEL SECURITY;

-- users
CREATE POLICY "users_select_authenticated"
  ON public.users FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "users_update_self_or_admin"
  ON public.users FOR UPDATE
  TO authenticated
  USING (id = auth.uid() OR public.is_admin())
  WITH CHECK (id = auth.uid() OR public.is_admin());

-- issues
CREATE POLICY "issues_select_authenticated"
  ON public.issues FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "issues_insert_authenticated"
  ON public.issues FOR INSERT
  TO authenticated
  WITH CHECK (creator_id = auth.uid());

-- 所有已登录成员可更新问题（便于认领、改状态、写进度）；删除仍为仅管理员
CREATE POLICY "issues_update_authenticated"
  ON public.issues FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "issues_delete_admin"
  ON public.issues FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- issue_updates
CREATE POLICY "issue_updates_select_authenticated"
  ON public.issue_updates FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "issue_updates_insert_own"
  ON public.issue_updates FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "issue_updates_delete_admin"
  ON public.issue_updates FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- reminders
CREATE POLICY "reminders_select_own_or_admin"
  ON public.reminders FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());

CREATE POLICY "reminders_update_own_or_admin"
  ON public.reminders FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid() OR public.is_admin())
  WITH CHECK (user_id = auth.uid() OR public.is_admin());

-- Inserts from app use service role in cron only; optional policy for authenticated admin manual insert
CREATE POLICY "reminders_insert_admin"
  ON public.reminders FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

-- ---------------------------------------------------------------------------
-- 附件
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 进度评论
-- ---------------------------------------------------------------------------
CREATE TABLE public.issue_update_comments (
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
