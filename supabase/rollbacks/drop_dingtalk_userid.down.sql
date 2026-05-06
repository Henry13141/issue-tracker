-- 回滚：drop_dingtalk_userid.sql
-- 恢复 users 表上的 dingtalk_userid 列。
--
-- 注意：此回滚仅还原表结构，历史数据已不可恢复。
-- 通常不需要执行此回滚——钉钉功能已全面废弃，仅在极端场景下（如版本回退）才需此操作。

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS dingtalk_userid TEXT;
