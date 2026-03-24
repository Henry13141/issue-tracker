# 内部问题跟踪与每日催办系统

Next.js App Router + TypeScript + Tailwind + shadcn/ui + Supabase（数据库与鉴权）。

## 本地开发

1. 复制环境变量：

   ```bash
   cp .env.local.example .env.local
   ```

   填入 Supabase 项目的 `NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_ANON_KEY`。

2. 在 Supabase SQL 编辑器中执行 [`supabase/schema.sql`](supabase/schema.sql) 创建表、触发器与 RLS。

3. （可选）将第一个账号设为管理员：

   ```sql
   UPDATE public.users SET role = 'admin' WHERE email = '你的邮箱';
   ```

4. （可选）执行 [`supabase/seed.sql`](supabase/seed.sql) 插入示例问题（需已至少注册一名用户）。

5. 安装依赖并启动：

   ```bash
   npm install
   npm run dev
   ```

6. 打开 [http://localhost:3000](http://localhost:3000)，注册/登录。

## 每日催办（Cron）

- 部署到 Vercel 时，[`vercel.json`](vercel.json) 会在 **UTC 09:30**（北京时间 **17:30**）请求 `/api/cron/daily-reminder`。
- 在 Vercel 环境变量中配置 **`SUPABASE_SERVICE_ROLE_KEY`**（服务端写入 `reminders` 表）。
- 可选：配置 **`CRON_SECRET`**；请求头 `Authorization: Bearer <CRON_SECRET>` 或 Vercel Cron 自带的 `x-vercel-cron: 1` 可通过校验。
- 本地手动触发：`curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/daily-reminder`

## 路由说明

| 路径 | 说明 |
|------|------|
| `/login` | 登录 / 注册 |
| `/dashboard` | 管理看板（仅 `admin`） |
| `/issues` | 问题列表 |
| `/issues/[id]` | 问题详情与进度时间线 |
| `/my-tasks` | 我的任务与快速更新 |
| `/reminders` | 提醒中心（管理员可见全员汇总） |

## 技术说明

- `public.users.id` 与 `auth.users.id` 一致，由 `on_auth_user_created` 触发器自动建档。
- 定时任务使用 **Service Role** 绕过 RLS；请勿在前端暴露 Service Role Key。
