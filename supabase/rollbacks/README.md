# Supabase 迁移回滚脚本

本目录存放关键迁移的回滚 SQL（down.sql 等效）。

## 使用方式

在 Supabase Dashboard → SQL Editor 中手动执行对应的 `.down.sql` 文件。

> ⚠️ 回滚是破坏性操作，执行前请：
> 1. 确认已备份相关数据
> 2. 在暂存环境验证回滚脚本
> 3. 记录回滚原因与时间戳

## 文件命名规范

`<迁移文件名>.down.sql` —— 与 `supabase/migrations/` 中的 `.sql` 文件一一对应。

## 已有回滚脚本

| 迁移文件 | 回滚脚本 | 说明 |
|---|---|---|
| `refine_issues_update_rls.sql` | `refine_issues_update_rls.down.sql` | 恢复宽松的 issues UPDATE 策略 |
| `drop_dingtalk_userid.sql` | `drop_dingtalk_userid.down.sql` | 恢复 dingtalk_userid 列（若需回退） |
| `p0_governance.sql` | `p0_governance.down.sql` | 删除治理字段、触发器、索引、issue_events 表 |
| `p1_notification_deliveries.sql` | `p1_notification_deliveries.down.sql` | 删除通知投递日志表及 RLS 策略 |
| `add_svn_daily_reports.sql` | `add_svn_daily_reports.down.sql` | 删除 SVN 日报表及 RLS 策略 |
