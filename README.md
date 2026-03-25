# 米伽米 · 工单管理系统

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

## 自动部署

- 仓库已通过 Vercel Git 集成连接。每次 `git push origin main`，**Vercel 会自动拉取构建并部署到 Production**，无需额外操作。
- **[`.github/workflows/ci.yml`](.github/workflows/ci.yml)**：向 `main` 推送或提 PR 时执行 `lint` + `build` 检查（使用占位 Supabase 环境变量，无需在 GitHub 配密钥）。

## 每日催办（Cron）

- **早晨温和提醒（未完成工单）**：[`vercel.json`](vercel.json) 在 **UTC 01:00**（北京时间 **09:00**）请求 `/api/cron/morning-assignee-digest`。会向每位**名下仍有未完成工单**（待处理 / 处理中 / 卡住 / 待验证）且已在「成员与企业微信」配置 **企业微信 userid** 的负责人，发送一条**语气温和**的应用消息（助理式文案），并附上问题列表与系统链接。需配置 `WECOM_*` 与 `NEXT_PUBLIC_APP_URL`。
- 部署到 Vercel 时，[`vercel.json`](vercel.json) 还会在 **UTC 09:30**（北京时间 **17:30**）请求 `/api/cron/daily-reminder`（按规则写入「提醒中心」并可选发催办类应用消息 / 群汇总）。
- 在 Vercel 环境变量中配置 **`SUPABASE_SERVICE_ROLE_KEY`**（服务端写入 `reminders` 表）。
- 可选：配置 **`CRON_SECRET`**；请求头 `Authorization: Bearer <CRON_SECRET>` 或 Vercel Cron 自带的 `x-vercel-cron: 1` 可通过校验。
- 本地手动触发：`curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/daily-reminder`
- **验证企业微信消息（可选）**：配置好 `WECOM_*` 后，可请求  
  `GET /api/cron/test-dingtalk?userid=企业微信通讯录userid`（未传 `userid` 时会从 `users.wecom_userid` 取第一条；需已执行下方迁移）。鉴权与 Cron 相同（若配置了 `CRON_SECRET` 则带 `Authorization: Bearer`）。
- **企业微信群汇总（可选）**：配置 `WECOM_WEBHOOK_URL`（群机器人 Webhook），在有新催办写入时向群内发一条 Markdown 汇总。
- **企业微信个人应用消息（可选）**：在 `.env.local` / Vercel 中配置 `WECOM_CORPID`、`WECOM_CORPSECRET`、`WECOM_AGENTID`（企业内部应用）。管理员在 **成员与企业微信**（`/members`）为每位成员填写企业微信通讯录 **userid** 后，Cron 会向对应员工发送私信催办。
- **事件通知（可选）**：新建且已指派、指派变更、标为阻塞、截止日期变更时，会向负责人发应用消息并向群内发 Markdown（与 Cron 相同依赖上述配置）。**问题标记为已解决 / 已关闭时**，会向**创建人与负责人**发企业微信私信（应用消息，二者去重），**不发给操作者本人**；若配置了群 Webhook 会同时发一条群摘要。请在环境变量中配置 **`NEXT_PUBLIC_APP_URL`**（生产站点根 URL），消息中的问题标题才会是可点击链接。
- **投递失败观测**：发送失败时会以 **`console.warn` + JSON** 打出（`scope: wecom_work_notice_delivery`），便于在 Vercel Logs 检索。成功默认不打日志；设置 **`WECOM_LOG_SUCCESSFUL_DELIVERY=1`** 可打出成功记录。
- **企业微信机器人导入问题（可选）**：在企业微信管理后台为应用配置「接收消息」能力，服务器 URL 填 `https://你的域名/api/wecom/robot`，配置 `WECOM_TOKEN` 和 `WECOM_ENCODING_AES_KEY`。在与应用的**单聊**中发送 Excel 文件，机器人自动解析并导入为新问题、回复导入结果。
- **企业微信扫码登录（可选）**：配置 `WECOM_CORPID`、`WECOM_AGENTID` 与 `NEXT_PUBLIC_APP_URL`，在企业微信管理后台 → 应用 → 网页授权 中配置可信域名（`你的域名`），登录页将显示「企业微信扫码登录」按钮，首次扫码自动注册绑定账号。
- **数据库迁移**：执行 `supabase/migrations/add_wecom_userid.sql` 添加 `wecom_userid` 列。

## 环境变量（企业微信）

| 变量 | 必须 | 说明 |
|------|------|------|
| `WECOM_CORPID` | 应用消息 / 扫码登录 | 企业微信 CorpID |
| `WECOM_CORPSECRET` | 应用消息 / 扫码登录 | 企业内部应用 Secret |
| `WECOM_AGENTID` | 应用消息 / 扫码登录 | 企业内部应用 AgentID（数字） |
| `WECOM_WEBHOOK_URL` | 群消息 | 群机器人 Webhook 地址 |
| `WECOM_TOKEN` | 机器人回调 | 回调校验 Token |
| `WECOM_ENCODING_AES_KEY` | 机器人回调 | 回调 AES 解密密钥（43位） |
| `WECOM_LOG_SUCCESSFUL_DELIVERY` | 可选 | 设为 `1` 打印成功发送日志 |

## 路由说明

| 路径 | 说明 |
|------|------|
| `/login` | 登录 / 注册 |
| `/dashboard` | 管理看板（仅 `admin`） |
| `/issues` | 问题列表 |
| `/issues/[id]` | 问题详情与进度时间线 |
| `/my-tasks` | 我的任务与快速更新 |
| `/reminders` | 提醒中心（管理员可见全员汇总） |
| `/members` | 成员与企业微信 userid（仅 `admin`） |
| `GET /api/auth/wecom/start` | 企业微信扫码登录发起 |
| `GET /api/auth/wecom/callback` | 企业微信 OAuth 回调 |
| `GET/POST /api/wecom/robot` | 企业微信机器人回调（接收文件→导入问题） |

## 技术说明

- `public.users.id` 与 `auth.users.id` 一致，由 `on_auth_user_created` 触发器自动建档。
- 定时任务使用 **Service Role** 绕过 RLS；请勿在前端暴露 Service Role Key。
