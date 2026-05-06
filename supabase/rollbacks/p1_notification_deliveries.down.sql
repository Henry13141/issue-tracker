-- 回滚：p1_notification_deliveries.sql
-- 删除通知投递日志表（含索引与 RLS 策略）。
--
-- ⚠️ 执行后所有通知记录将永久丢失，建议先备份：
--   COPY public.notification_deliveries TO '/tmp/notification_deliveries_backup.csv' CSV HEADER;

DROP TABLE IF EXISTS public.notification_deliveries CASCADE;
