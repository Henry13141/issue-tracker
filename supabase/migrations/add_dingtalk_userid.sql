-- 已有数据库在 Supabase SQL Editor 中执行本文件（新建库请直接用 schema.sql）
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS dingtalk_userid TEXT;
