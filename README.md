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

## 自动部署（GitHub Actions）

仓库已包含：

- **[`.github/workflows/ci.yml`](.github/workflows/ci.yml)**：向 `main` 推送或提 PR 时执行 `lint` + `build`（使用占位 Supabase 环境变量，无需在 GitHub 配密钥）。
- **[`.github/workflows/vercel-production.yml`](.github/workflows/vercel-production.yml)**：向 `main` 推送时用 Vercel CLI 部署 **Production**。

在 GitHub 仓库 **Settings → Secrets and variables → Actions** 中新建：

| Secret | 说明 |
|--------|------|
| `VERCEL_TOKEN` | [Vercel Account → Tokens](https://vercel.com/account/tokens) 创建 |
| `VERCEL_ORG_ID` | 本地项目根目录执行 `npx vercel link` 后，`.vercel/project.json` 里的 `orgId` |
| `VERCEL_PROJECT_ID` | 同上文件里的 `projectId` |

配置完成后，每次 `git push origin main` 会触发自动部署。

**说明**：若已在 Vercel 控制台把本仓库接好 Git，推送时 Vercel 也会自动部署一次。若不想重复部署，可在 Vercel 项目 **Settings → Git** 中关闭 **Automatic deployments**，仅保留 GitHub Actions；或删除 `vercel-production.yml`、只用 Vercel 自带集成。

## 每日催办（Cron）

- **早晨温和提醒（未完成工单）**：[`vercel.json`](vercel.json) 在 **UTC 01:00**（北京时间 **09:00**）请求 `/api/cron/morning-assignee-digest`。会向每位**名下仍有未完成工单**（待处理 / 处理中 / 卡住 / 待验证）且已在「成员与钉钉」配置 **钉钉 userid** 的负责人，发送一条**语气温和**的钉钉工作通知（助理式文案），并附上问题列表与系统链接。需配置 `DINGTALK_*` 与 `NEXT_PUBLIC_APP_URL`（或 Vercel 自动的 `VERCEL_URL`）。
- 部署到 Vercel 时，[`vercel.json`](vercel.json) 还会在 **UTC 09:30**（北京时间 **17:30**）请求 `/api/cron/daily-reminder`（按规则写入「提醒中心」并可选发催办类工作通知 / 群汇总）。
- 在 Vercel 环境变量中配置 **`SUPABASE_SERVICE_ROLE_KEY`**（服务端写入 `reminders` 表）。
- 可选：配置 **`CRON_SECRET`**；请求头 `Authorization: Bearer <CRON_SECRET>` 或 Vercel Cron 自带的 `x-vercel-cron: 1` 可通过校验。
- 本地手动触发：`curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/daily-reminder`
- **验证钉钉工作通知（可选）**：配置好 `DINGTALK_*` 后，可请求  
  `GET /api/cron/test-dingtalk?userid=钉钉通讯录userid`（未传 `userid` 时会从 `users.dingtalk_userid` 取第一条；需已执行下方迁移）。鉴权与 Cron 相同（若配置了 `CRON_SECRET` 则带 `Authorization: Bearer`）。
- **钉钉群汇总（可选）**：配置 `DINGTALK_WEBHOOK_URL`，在有新催办写入时向群内发一条 Markdown 汇总。
- **钉钉个人工作通知（可选）**：在 `.env.local` / Vercel 中配置 `DINGTALK_APP_KEY`、`DINGTALK_APP_SECRET`、`DINGTALK_AGENT_ID`（企业内部应用）。管理员在 **成员与钉钉**（`/members`）为每位成员填写钉钉通讯录 **userid** 后，Cron 会向对应员工发送私信催办。
- **事件通知（可选）**：新建且已指派、指派变更、标为阻塞、截止日期变更时，会向负责人发工作通知并向群内发 Markdown（与 Cron 相同依赖上述配置）。**问题标记为已解决 / 已关闭时**，会向**创建人与负责人**发钉钉私信（工作通知，二者去重），**不发给操作者本人**；若配置了群 Webhook 会同时发一条群摘要。请在环境变量中配置 **`NEXT_PUBLIC_APP_URL`**（生产站点根 URL），消息中的问题标题才会是可点击链接。
- **投递结果观测**：每次工作通知发送后会调用钉钉「查询发送结果」接口；**投递失败**（无效 userid、无权限等）会以 **`console.warn` + JSON** 打出，便于在 Vercel Logs 检索 `dingtalk_work_notice_delivery`。成功默认不打日志；设置 **`DINGTALK_LOG_SUCCESSFUL_DELIVERY=1`** 可打出成功记录。可选 **`DINGTALK_DELIVERY_POLL_DELAY_MS`** 调整轮询前等待毫秒数（默认 2000）。
- **钉钉机器人导入问题（可选）**：在钉钉开放平台为你的企业内部应用启用「机器人」能力，消息接收模式选 **HTTP**，地址填 `https://你的域名/api/dingtalk/robot`。在与机器人的**单聊**中发送 Excel 文件，机器人自动解析并导入为新问题、回复导入结果。所需权限：「企业内机器人发送消息权限」。`robotCode` 默认取 `DINGTALK_APP_KEY`，若开放平台上不同可单独配置 `DINGTALK_ROBOT_CODE`。
- **钉钉开放平台**：在应用 → **权限管理** 中开通与工作通知 / 企业内消息相关的权限（如「企业内机器人发送消息」等，以控制台实际名称为准）。**userid** 可在钉钉管理后台 → 通讯录 → 成员详情中查看。
- 若数据库是早期创建的，请在 Supabase SQL 中执行：`ALTER TABLE public.users ADD COLUMN IF NOT EXISTS dingtalk_userid TEXT;`（或执行 `supabase/migrations/` 下对应迁移）。

## 路由说明

| 路径 | 说明 |
|------|------|
| `/login` | 登录 / 注册 |
| `/dashboard` | 管理看板（仅 `admin`） |
| `/issues` | 问题列表 |
| `/issues/[id]` | 问题详情与进度时间线 |
| `/my-tasks` | 我的任务与快速更新 |
| `/reminders` | 提醒中心（管理员可见全员汇总） |
| `/members` | 成员与钉钉 userid（仅 `admin`） |
| `POST /api/dingtalk/robot` | 钉钉机器人回调（接收文件→导入问题） |

## 技术说明

- `public.users.id` 与 `auth.users.id` 一致，由 `on_auth_user_created` 触发器自动建档。
- 定时任务使用 **Service Role** 绕过 RLS；请勿在前端暴露 Service Role Key。
