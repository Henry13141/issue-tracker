# 米伽米 · 工单管理系统

> 内部工单协同平台，支持企业微信扫码登录、应用消息推送（兼容个人微信）、群机器人通知、每日 Cron 催办。

**技术栈：** Next.js 16 (App Router) · TypeScript · Tailwind CSS · shadcn/ui · Supabase（PostgreSQL + Auth）· Vercel（部署 + Cron）· 企业微信开放平台

**线上地址：** https://tracker.megami-tech.com  
**历史版本（钉钉）：** 分支 `legacy/dingtalk`

---

## 目录

- [功能概览](#功能概览)
- [项目结构](#项目结构)
- [数据库设计](#数据库设计)
- [企业微信集成](#企业微信集成)
- [Cron 定时任务](#cron-定时任务)
- [环境变量](#环境变量)
- [本地开发](#本地开发)
- [部署（Vercel）](#部署vercel)
- [API 路由一览](#api-路由一览)
- [常见问题](#常见问题)

---

## 功能概览

| 功能 | 说明 |
|------|------|
| 邮箱注册 / 登录 | 标准邮箱 + 密码（Supabase Auth） |
| 企业微信扫码登录 | OAuth 扫码，首次自动注册，个人微信可收消息 |
| 工单管理 | 创建、指派、更新状态、写进度、附件上传 |
| 提醒中心 | 自动写入「今日未更新 / 超期 / 连续3天无更新」提醒 |
| 管理看板 | 管理员可见全量工单统计 |
| 企业微信私信催办 | 按人发应用消息（兼容个人微信 / 微信插件） |
| 企业微信群机器人 | Webhook 往指定群推 Markdown 汇总 |
| 每日 Cron 催办 | 早晨温和提醒 + 下午管理员督促 + 17:30 工单汇总 |
| Excel 机器人导入 | 企业微信机器人接收 Excel 文件，自动创建工单 |

---

## 项目结构

```
src/
├── app/
│   ├── (auth)/login/          # 登录 / 注册页
│   ├── (main)/
│   │   ├── dashboard/         # 管理看板（admin only）
│   │   ├── issues/            # 工单列表 + 详情
│   │   ├── my-tasks/          # 我的任务
│   │   ├── members/           # 成员与企业微信 userid 管理（admin only）
│   │   └── reminders/         # 提醒中心
│   └── api/
│       ├── auth/wecom/        # 企业微信 OAuth（start + callback）
│       ├── cron/
│       │   ├── morning-assignee-digest/  # 09:00 早晨提醒
│       │   ├── admin-escalation/         # 16:00 管理员督促
│       │   ├── daily-reminder/           # 17:30 催办 + 提醒中心
│       │   ├── test-dingtalk/            # 手动测试消息发送
│       │   ├── check-ip/                 # 查询 Vercel 出口 IP
│       │   └── notify-register/          # 手动群发注册通知
│       └── wecom/robot/       # 企业微信机器人回调（Excel 导入）
├── actions/
│   ├── issues.ts              # 工单 CRUD Server Actions
│   └── members.ts             # 成员管理 Server Actions
├── components/                # UI 组件（shadcn/ui）
├── lib/
│   ├── wecom.ts               # 企业微信 API 核心库
│   ├── issue-dingtalk-notify.ts  # 工单事件 → 企业微信通知
│   ├── new-member-welcome.ts  # 新成员欢迎消息
│   ├── dingtalk.ts            # 旧钉钉库（保留供参考，已不调用）
│   └── ...
├── types/index.ts             # 全局 TypeScript 类型
supabase/
├── schema.sql                 # 完整建表 SQL
├── seed.sql                   # 示例数据
└── migrations/
    ├── add_wecom_userid.sql   # 新增 wecom_userid 列
    └── ...
```

---

## 数据库设计

### 表结构

```sql
-- 用户（与 auth.users 一对一）
public.users
  id            UUID PK (= auth.users.id)
  email         TEXT UNIQUE
  name          TEXT
  role          TEXT  -- 'admin' | 'member'
  avatar_url    TEXT
  wecom_userid  TEXT  -- 企业微信通讯录 userid，用于应用消息推送
  created_at    TIMESTAMPTZ
  updated_at    TIMESTAMPTZ

-- 工单
public.issues
  id            UUID PK
  title         TEXT
  description   TEXT
  status        TEXT  -- todo | in_progress | blocked | pending_review | resolved | closed
  priority      TEXT  -- low | medium | high | urgent
  assignee_id   UUID → users
  creator_id    UUID → users
  due_date      DATE
  resolved_at   TIMESTAMPTZ
  closed_at     TIMESTAMPTZ

-- 进度更新（时间线）
public.issue_updates
  id            UUID PK
  issue_id      UUID → issues
  user_id       UUID → users
  content       TEXT
  status_from   TEXT
  status_to     TEXT

-- 提醒中心
public.reminders
  id            UUID PK
  issue_id      UUID → issues
  user_id       UUID → users
  type          TEXT  -- no_update_today | overdue | stale_3_days
  message       TEXT
  is_read       BOOLEAN
```

### 权限（RLS）

- 所有表开启 RLS；已登录用户可读自己相关数据；admin 可读写全量。
- Cron 路由使用 **Service Role Key** 绕过 RLS 直接写入。

---

## 企业微信集成

### 架构图

```
用户浏览器
  │ 点「企业微信扫码登录」
  ↓
/api/auth/wecom/start
  │ 302 redirect
  ↓
企业微信 OAuth 扫码页
  │ 扫码成功，返回 code
  ↓
/api/auth/wecom/callback
  │ 用 code 换 userid → 查/建 Supabase 用户 → 签发 session
  ↓
进入系统

Cron / 工单事件
  │ 调 sendWecomWorkNotice(userid, title, text)
  ↓
企业微信应用消息 API
  │ 推送到用户企业微信
  ↓
若用户关注了「微信插件」→ 个人微信也收到
```

### 核心文件：`src/lib/wecom.ts`

| 函数 | 作用 |
|------|------|
| `getAccessToken()` | 换取并缓存企业 access_token |
| `sendWecomWorkNotice(userid, title, text)` | 发应用消息（text 类型，兼容个人微信） |
| `sendWecomMarkdown(content)` | 发群机器人 Webhook 消息 |
| `getUserInfoByCode(code)` | OAuth code → 企业内 userid |
| `verifyWecomSignature(...)` | 机器人回调签名验证 |
| `decryptWecomMessage(encrypted)` | AES-256-CBC 解密机器人消息 |

### 个人微信接收消息（微信插件）

1. 管理后台 → **我的企业 → 微信插件**，拿到关注二维码。
2. 员工用**个人微信**扫码关注企业。
3. 关注后，应用消息自动推送到个人微信。

> 注意：消息类型必须是 `text`（纯文本），`markdown` 类型个人微信无法显示。

### 企业微信可信 IP

Vercel Serverless 出口 IP 会轮换，需加到企业微信后台「企业可信IP」白名单。

实时查询当前出口 IP：
```
GET https://tracker.megami-tech.com/api/cron/check-ip
```

目前已加的 IP（随 Vercel 部署变化）：
```
52.207.195.54
3.92.222.47
18.209.102.18
44.202.213.65
```

---

## Cron 定时任务

| 时间（北京时间）| 路由 | 功能 |
|----------------|------|------|
| 09:00 每天 | `/api/cron/morning-assignee-digest` | 向有未完成工单的负责人发温和早晨提醒 |
| 16:00 每天 | `/api/cron/admin-escalation` | 向管理员推送「今日未更新」督促汇总 |
| 17:30 每天 | `/api/cron/daily-reminder` | 写提醒中心 + 推个人通知 + 推群汇总 |

触发条件：Vercel Cron 自动触发（`vercel.json`），或带 `Authorization: Bearer $CRON_SECRET` 手动调用。

手动测试消息发送：
```
GET https://tracker.megami-tech.com/api/cron/test-dingtalk?userid=你的wecom_userid
```

---

## 环境变量

### 必须配置

| 变量 | 说明 |
|------|------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase 项目 URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase 匿名 Key（前端） |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Service Role Key（Cron 服务端） |
| `NEXT_PUBLIC_APP_URL` | 线上根 URL，无尾斜杠，如 `https://tracker.megami-tech.com` |

### 企业微信（应用消息 + 扫码登录）

| 变量 | 说明 | 获取位置 |
|------|------|----------|
| `WECOM_CORPID` | 企业 ID | 管理后台 → 我的企业 → 企业信息 |
| `WECOM_CORPSECRET` | 应用 Secret | 管理后台 → 应用管理 → 自建应用 → Secret |
| `WECOM_AGENTID` | 应用 AgentID（数字）| 管理后台 → 应用管理 → 自建应用 → AgentId |

### 企业微信（可选）

| 变量 | 说明 |
|------|------|
| `WECOM_WEBHOOK_URL` | 群机器人 Webhook URL（群里「添加机器人」获取） |
| `WECOM_TOKEN` | 机器人回调 Token（接收消息 / Excel 导入时配置） |
| `WECOM_ENCODING_AES_KEY` | 机器人回调 AES 密钥（43 位，接收消息时配置） |
| `WECOM_LOG_SUCCESSFUL_DELIVERY` | 设为 `1` 时打印成功发送日志 |

### 其他（可选）

| 变量 | 说明 |
|------|------|
| `CRON_SECRET` | Cron 鉴权密钥，请求头带 `Authorization: Bearer <值>` |

---

## 本地开发

```bash
# 1. 安装依赖
npm install

# 2. 复制环境变量
cp .env.local.example .env.local
# 填入 NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY
# 填入企业微信相关变量（可选，不配则无通知功能）

# 3. 初始化数据库（在 Supabase SQL 编辑器执行）
# supabase/schema.sql           → 建表
# supabase/migrations/add_wecom_userid.sql → 加 wecom_userid 列

# 4. 把第一个账号设为管理员（在 Supabase SQL 编辑器执行）
UPDATE public.users SET role = 'admin' WHERE email = '你的邮箱';

# 5. 启动
npm run dev
```

访问 http://localhost:3000

---

## 部署（Vercel）

```bash
# 首次关联（仅需一次）
npx vercel link

# 写入环境变量
printf 'https://tracker.megami-tech.com' | npx vercel env add NEXT_PUBLIC_APP_URL production
printf 'your_corpid'    | npx vercel env add WECOM_CORPID production
printf 'your_agentid'   | npx vercel env add WECOM_AGENTID production
printf 'your_secret'    | npx vercel env add WECOM_CORPSECRET production

# 部署
npx vercel --prod
```

**每次推送到 `main` 分支，Vercel 自动构建部署。**

### 轻量服务器（监控 / 网关 / Redis / Webhook 备份）

运维栈说明与一键部署步骤见仓库 **[deploy/infra/README.md](deploy/infra/README.md)**（Caddy、Uptime Kuma、Redis、Webhook 中继、备份脚本）。

### 企业微信后台配置清单

| 配置项 | 填写内容 | 位置 |
|--------|----------|------|
| 可信域名（OAuth）| `tracker.megami-tech.com` | 应用 → 网页授权及JS-SDK |
| 授权回调域名 | `tracker.megami-tech.com` | 应用 → 企业微信授权登录 |
| 域名验证文件 | 已放在 `public/WW_verify_*.txt` | Vercel 自动托管 |
| 企业可信 IP | 见上方 IP 列表 | 应用 → 企业可信IP |
| 应用可见范围 | 全公司或指定部门 | 应用 → 可见范围 |

---

## API 路由一览

| 方法 | 路径 | 说明 | 鉴权 |
|------|------|------|------|
| GET | `/login` | 登录 / 注册页 | 无 |
| GET | `/api/auth/wecom/start` | 企业微信扫码登录发起 | 无 |
| GET | `/api/auth/wecom/callback` | 企业微信 OAuth 回调 | 无 |
| GET/POST | `/api/wecom/robot` | 企业微信机器人（Excel 导入） | WeCom 签名 |
| GET | `/api/cron/morning-assignee-digest` | 早晨工单提醒 | Cron Secret |
| GET | `/api/cron/admin-escalation` | 管理员督促通知 | Cron Secret |
| GET | `/api/cron/daily-reminder` | 每日催办 + 提醒中心 | Cron Secret |
| GET | `/api/cron/test-dingtalk` | 手动发测试消息 `?userid=xxx` | Cron Secret |
| GET | `/api/cron/check-ip` | 查询 Vercel 当前出口 IP | Cron Secret |

---

## 常见问题

**Q: 企业微信报「not allow to access from your ip」**  
A: Vercel 出口 IP 轮换。访问 `/api/cron/check-ip` 查当前 IP，加到企业微信「企业可信IP」白名单。

**Q: 个人微信收到「暂不支持此消息类型」**  
A: 应用消息需用 `text` 类型，`markdown` 类型个人微信不支持。当前代码已处理。

**Q: 扫码登录报「redirect_uri 与配置不一致」**  
A: 企业微信应用 → 企业微信授权登录 → 授权回调域名，填 `tracker.megami-tech.com`（无 `https://`）。

**Q: Cron 没有发消息**  
A: 检查以下三项：① `/members` 里成员的 `wecom_userid` 是否已填；② 应用「可见范围」是否包含该成员；③ Vercel 出口 IP 是否在白名单。

**Q: 想查看旧版钉钉代码**  
A: 切换到 GitHub 分支 `legacy/dingtalk`。

---

## 技术说明

- `public.users.id` 与 `auth.users.id` 一致，由 `on_auth_user_created` 触发器自动建档。
- 企业微信扫码用户的邮箱格式为 `wecom.{userid}@mgm-wecom.placeholder`（虚拟邮箱，用于对接 Supabase Auth）。
- 定时任务使用 **Service Role Key** 绕过 RLS，**不要在前端暴露该 Key**。
- 应用消息使用 `text` 类型（非 `markdown`），确保在个人微信（微信插件）中正常显示。
