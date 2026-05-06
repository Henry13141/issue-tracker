-- 回滚：p0_governance.sql
-- 删除治理字段、触发器、函数、索引、issue_events 表。
--
-- ⚠️ 这是一个高破坏性回滚：
--   - issue_events 表的所有事件记录将被永久删除
--   - issues 治理字段（last_activity_at / reopen_count 等）的历史数据将丢失
-- 执行前请确认已备份相关数据。

-- 1. 删除触发器与函数
DROP TRIGGER IF EXISTS issue_updates_touch_last_activity ON public.issue_updates;
DROP FUNCTION IF EXISTS public.touch_issue_last_activity();

-- 2. 删除 issue_events 表（含 RLS 策略，CASCADE 自动删除策略和索引）
DROP TABLE IF EXISTS public.issue_events CASCADE;

-- 3. 删除补充索引
DROP INDEX IF EXISTS public.idx_issues_priority;
DROP INDEX IF EXISTS public.idx_issues_reviewer;
DROP INDEX IF EXISTS public.idx_issues_last_activity;
DROP INDEX IF EXISTS public.idx_issue_updates_issue_created;
DROP INDEX IF EXISTS public.idx_reminders_user_read_created;

-- 4. 从 issue_updates 删除治理字段
ALTER TABLE public.issue_updates
  DROP COLUMN IF EXISTS update_type,
  DROP COLUMN IF EXISTS is_system_generated;

-- 5. 从 issues 删除治理字段
ALTER TABLE public.issues
  DROP COLUMN IF EXISTS category,
  DROP COLUMN IF EXISTS module,
  DROP COLUMN IF EXISTS source,
  DROP COLUMN IF EXISTS reviewer_id,
  DROP COLUMN IF EXISTS blocked_reason,
  DROP COLUMN IF EXISTS closed_reason,
  DROP COLUMN IF EXISTS reopen_count,
  DROP COLUMN IF EXISTS last_activity_at;
