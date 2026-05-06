-- 回滚：add_svn_daily_reports.sql
-- 删除 SVN 日报表、触发器、函数及 RLS 策略。
--
-- ⚠️ 执行后所有 SVN 日报数据将永久丢失，建议先备份：
--   COPY public.svn_daily_reports TO '/tmp/svn_daily_reports_backup.csv' CSV HEADER;

DROP TRIGGER IF EXISTS svn_daily_reports_updated_at ON public.svn_daily_reports;
DROP FUNCTION IF EXISTS public.update_svn_daily_reports_updated_at();
DROP TABLE IF EXISTS public.svn_daily_reports CASCADE;
