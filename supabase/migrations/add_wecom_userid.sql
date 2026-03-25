-- 迁移：将钉钉 userid 替换为企业微信 userid
-- 执行前提：已执行 add_dingtalk_userid.sql
-- 若数据库中已有 dingtalk_userid 数据，可先人工将其复制到新列（如字段对应），再 DROP 旧列。

-- 1. 添加企业微信 userid 列
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS wecom_userid TEXT;

-- 2. 为查询创建索引（机器人回调与 OAuth 回调通过 wecom_userid 查找用户）
CREATE INDEX IF NOT EXISTS idx_users_wecom_userid ON public.users (wecom_userid);

-- 3. （可选）若旧 dingtalk_userid 列仍存在，且确认已完成切换后可删除：
-- ALTER TABLE public.users DROP COLUMN IF EXISTS dingtalk_userid;
