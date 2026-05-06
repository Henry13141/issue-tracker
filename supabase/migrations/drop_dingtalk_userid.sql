-- 系统已全面切换为企业微信（WeChat Work），不再使用钉钉。
-- 删除 users 表上的 dingtalk_userid 列（与 add_dingtalk_userid.sql 对应）。
ALTER TABLE public.users DROP COLUMN IF EXISTS dingtalk_userid;
