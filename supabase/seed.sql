-- Optional seed data. Requires at least one row in public.users (sign up once after applying schema).
-- Run in Supabase SQL Editor after schema.sql.

DO $$
DECLARE
  u_creator uuid;
  u_a uuid;
  u_b uuid;
BEGIN
  SELECT id INTO u_creator FROM public.users ORDER BY created_at LIMIT 1;
  IF u_creator IS NULL THEN
    RAISE NOTICE 'seed skipped: no users. Register one account first.';
    RETURN;
  END IF;

  SELECT id INTO u_a FROM public.users ORDER BY created_at OFFSET 0 LIMIT 1;
  SELECT id INTO u_b FROM public.users ORDER BY created_at OFFSET 1 LIMIT 1;
  IF u_b IS NULL THEN
    u_b := u_a;
  END IF;

  INSERT INTO public.issues (title, description, status, priority, assignee_id, creator_id, due_date)
  VALUES
    ('示例：登录按钮在暗色模式下对比度不足', '复现：设置主题为暗色，打开登录页。', 'in_progress', 'high', u_a, u_creator, CURRENT_DATE - 1),
    ('示例：关卡 3 BOSS 血量异常', '期望 10000，实际 1。', 'blocked', 'urgent', u_b, u_creator, CURRENT_DATE + 3),
    ('示例：新手引导文案错别字', '「开始游戏」写成了「开使游戏」。', 'pending_review', 'low', u_a, u_creator, CURRENT_DATE),
    ('示例：已修复的音效延迟', '已合并，待验证。', 'resolved', 'medium', u_a, u_creator, CURRENT_DATE - 2),
    ('示例：归档的历史任务', '无。', 'closed', 'low', u_a, u_creator, CURRENT_DATE - 10);

  -- Progress updates on first two issues (if just inserted, may duplicate on re-run — safe to ignore duplicates by deleting seed issues first)
  INSERT INTO public.issue_updates (issue_id, user_id, content, status_from, status_to)
  SELECT i.id, u_a, '已开始排查 UI 变量。', 'todo', 'in_progress'
  FROM public.issues i
  WHERE i.title LIKE '示例：登录按钮%'
  LIMIT 1;

  INSERT INTO public.issue_updates (issue_id, user_id, content, status_from, status_to)
  SELECT i.id, u_b, '需要程序提供数值表。', 'in_progress', 'blocked'
  FROM public.issues i
  WHERE i.title LIKE '示例：关卡 3%'
  LIMIT 1;

END $$;
