# Seedance 2.0 全面参考（产品 · API · 提示词 · 本仓库集成）

> **文档性质**：面向产品与研发的综合笔记，综合了火山引擎方舟公开文档、**Ark Docs MCP** 实时检索结果、本仓库源码约定与落地经验。**非官方原文**；接口字段、模型 ID、价格以 [火山方舟文档](https://www.volcengine.com/docs/82379/1330310?lang=zh) 与控制台为准。  
> **最后整理**：仓库初版约 2026-04 初；**第 12 节**经 Ark Docs MCP（`ark_search_docs` / `ark_fetch_doc` / `ark_get_model` / `ark_search_examples`）于 **2026-04-06** 补充，仍须与官网逐条核对。

---

## 1. Seedance 2.0 是什么

Seedance 2.0 是火山方舟（Volcengine Ark）上的**视频生成**模型系列，强调：

- **自然语言**：对「谁在做什么、在什么环境、什么风格」理解较好。
- **音画联合**：原生支持**音频 + 视频**联合生成（具体以当前模型能力说明为准）。
- **多模态参考**：图像、视频、音频可作为参考输入，用于锁定主体、动作、运镜、特效等。
- **文字与字幕**：在 T2V / I2V / R2V / V2V 等场景下可描述常见文字、广告语、字幕、气泡台词等（需写清时机、位置、方式）。
- **视频编辑向能力**：文档侧描述包括增删改元素、前后延长、多段轨道补齐等；实际可用性以接口与模型版本为准。

同系列常见变体：

| 名称（产品侧） | 本仓库使用的模型 ID（示例） |
|----------------|-----------------------------|
| Seedance 2.0 标准版 | `doubao-seedance-2-0-260128` |
| Seedance 2.0 Fast | `doubao-seedance-2-0-fast-260128` |

---

## 2. 官方文档索引（建议收藏）

| 主题 | 链接 |
|------|------|
| Seedance 2.0 系列教程（含 SDK 示例入口） | https://www.volcengine.com/docs/82379/2291680?lang=zh |
| Seedance 2.0 系列提示词指南 | https://www.volcengine.com/docs/82379/2222480?lang=zh |
| 视频生成教程总页（含 Seedance 2.0 能力说明与多语言示例） | https://www.volcengine.com/docs/82379/1366799?lang=zh |
| Video Generation API（文档导航中的 API 条目） | https://www.volcengine.com/docs/82379/1520758?lang=zh |
| 创建视频生成任务 API | https://www.volcengine.com/docs/82379/1520757?lang=zh |
| 查询视频生成任务 API | https://www.volcengine.com/docs/82379/1521309?lang=zh |
| Web Search（联网搜索）工具 | https://www.volcengine.com/docs/82379/1756990?lang=zh |
| 方舟文档 MCP（IDE 内检索最新 Spec） | https://www.volcengine.com/docs/82379/2289964?lang=zh |

仓库内另有精简版提示词学习笔记：`SEEDANCE_2_PROMPT_GUIDE.md`（可与本文档对照阅读）。

---

## 3. 方舟 HTTP API（本仓库调用方式）

### 3.1 基址与鉴权

- **Base URL**：`https://ark.cn-beijing.volces.com/api/v3`（见 `src/lib/ark-seedance.ts`）
- **创建任务**：`POST /contents/generations/tasks`
- **查询任务**：`GET /contents/generations/tasks/{task_id}`
- **删除/取消任务**：`DELETE /contents/generations/tasks/{task_id}`
- **任务列表**：`GET /contents/generations/tasks?page_num=&page_size=`
- **鉴权**：请求头 `Authorization: Bearer <ARK_API_KEY>`

服务端环境变量：**`ARK_API_KEY`**（本仓库 `isSeedanceConfigured()` 据此判断是否已配置）。

### 3.2 请求体核心字段（与类型定义对齐）

以下为 `SeedanceCreateTaskInput`（`ark-seedance.ts`）层面的字段说明；**最终以官方 OpenAPI 为准**。

| 字段 | 说明 |
|------|------|
| `model` | 模型名称 / ID |
| `content` | 多段内容：文本、图、参考视频、参考音频等（见第 5 节） |
| `generate_audio` | 是否生成音频（2.0 / 2.0 fast 支持） |
| `ratio` | 画幅比例 |
| `duration` | 时长（秒）；本仓库另支持 `-1` 表示「智能时长」 |
| `resolution` | 可选：`480p` / `720p` / `1080p`（标准版支持 1080p；fast 版不支持） |
| `watermark` | 是否水印 |
| `return_last_frame` | 可选：是否返回尾帧 |
| `safety_identifier` | 可选：安全标识（本仓库对用户有默认派生逻辑） |
| `tools` | 可选：工具列表，例如联网搜索（仅纯文本时可开） |
| `seed` | 可选：种子 `[-1, 2^32-1]`；`-1` 表示随机（`SEEDANCE_SEED` 常量） |

> `service_tier`、`callback_url`、`execution_expires_after` 等高级参数当前未透传（走方舟默认值），如有需要可在 `listSeedanceTasks` / `createSeedanceTask` 层按需扩展。

### 3.3 任务列表 filter 参数（`GET /contents/generations/tasks`）

`listSeedanceTasks` 支持 `filter` 参数（`SeedanceListFilter`）：

| 参数 | 说明 |
|------|------|
| `filter.status` | 按状态过滤，合法值：`queued/running/cancelled/succeeded/failed/expired` |
| `filter.task_ids` | 按任务 ID 精确查询（数组，多个 ID 用重复 key） |
| `filter.model` | 按推理接入点 ID 过滤 |
| `filter.service_tier` | 按服务等级过滤（`default` / `flex`） |

`page_size` 上限为 **500**（与接口文档一致）。

### 3.4 任务状态（终端态）

本仓库将以下状态视为**已结束**，可停止轮询：`succeeded`、`failed`、`cancelled`、**`expired`**（`isSeedanceTerminalStatus`）。

> 注意：`expired` 表示任务在排队或运行中超过了 `execution_expires_after` 阈值（默认 48h），是第三种合法终态，**必须**纳入轮询终止判断，否则会持续无效轮询。

---

## 4. 参数与限制（本仓库与官方教程对齐部分）

定义见 `src/lib/seedance-params.ts`。

### 4.1 画幅 `ratio`

允许值：`16:9`、`9:16`、`1:1`、`3:4`、`4:3`、`21:9`、`adaptive`（自适应）。

### 4.2 分辨率 `resolution`

允许值：`480p`、`720p`、**`1080p`**。

- **标准版**（`doubao-seedance-2-0-260128`）：支持全部三档。
- **Fast 版**（`doubao-seedance-2-0-fast-260128`）：**不支持 1080p**；在 `isResolutionAllowedForModel` 中做模型级校验，UI 上对应按钮会置灰，切换到 fast 时若已选 1080p 自动退回 720p。

### 4.3 时长 `duration`

- 官方教程侧常见描述为 **4～15 秒** 的输出范围；本仓库校验：**整数秒且落在 4～15**，或 **`-1`（智能时长）**。
- UI 预设示例：`4、5、8、10、11、15` 秒。

### 4.4 多模态参考数量上限

| 类型 | 上限 |
|------|------|
| 参考图片 | 9 |
| 参考视频 | 3 |
| 参考音频 | 3 |

**本仓库额外校验**：不允许**仅有音频**而无任何图片或视频（`validateSeedanceReferenceCounts`），与产品侧「音频需配合画面参考」的约束一致。

### 4.5 轮询建议

- 基准间隔约 **8s**，带 **1.2s** 随机抖动（`SEEDANCE_POLL_INTERVAL_MS` / `SEEDANCE_POLL_JITTER_MS`）。
- 遇 **429** 时可指数退避，上限约 **60s**（`SEEDANCE_POLL_429_BACKOFF_MAX_MS`）。

---

## 5. `content` 结构与角色（多模态）

单条 `content` 可为：

- **文本**：`{ "type": "text", "text": "..." }`
- **图片 URL**：`{ "type": "image_url", "image_url": { "url": "..." }, "role"?: ... }`
- **参考视频**：`{ "type": "video_url", "role": "reference_video", "video_url": { "url": "..." } }`
- **参考音频**：`{ "type": "audio_url", "role": "reference_audio", "audio_url": { "url": "..." } }`

### 5.1 图片 `role`

- `reference_image`：一般参考图  
- `first_frame`：首帧  
- `last_frame`：尾帧  

单图且无 `role` 时，在本仓库校验逻辑里可按「首帧」语义处理（与仅一张首帧图场景兼容）。

### 5.2 本仓库的「模式互斥」规则（`tasks/route.ts`）

以下校验在调用方舟前执行，避免非法组合：

1. **首帧 / 首尾帧模式** 与 **多模态参考模式**（参考图 + 参考视频/音频）**互斥**。  
   - 不能同时：既要 `first_frame`/`last_frame`，又要 `reference_image` 或参考音视频。
2. **尾帧**：必须同时提供 **首帧**；且首尾帧场景下 **恰好 2 张图**，分别为 `first_frame` 与 `last_frame`。
3. **仅首帧、不要尾帧**：最多 **1 张图**（且无 `reference_image` 混用）。

---

## 6. 联网搜索工具 `web_search`

- 请求体中可传 `tools: [{ "type": "web_search" }]`（与方舟 Web Search 文档一致方向）。
- **本仓库约束**：仅当 **没有任何** 图片、视频、音频参考时允许开启（纯文本场景）。  
  否则返回错误：「联网搜索仅适用于纯文本输入」。

---

## 7. 计费与 Token 估算（本仓库实现说明）

`src/lib/seedance-pricing.ts` 中维护了用于**站内展示估算**的单价与像素表：

- **单价**：按「百万 token 人民币」估算，区分 **是否含参考视频输入** 与 **输出分辨率是否为 1080p**（标准版 1080p 有独立定价）。  
- **输出像素**：按 `resolution` + 固定比例（不含 `adaptive`）映射宽高，再结合 **时长 × 宽 × 高 × 24 / 1024** 估算 token。  
  > 官方实际公式为 `(输入视频时长 + 输出视频时长) × 宽 × 高 × 帧率 / 1024`；含视频输入时还存在最低 token 用量限制，UI 提示中已说明。

**重要**：表格内数字为**项目内配置**，便于产品演示；**商务与对账务必以官方「模型价格」页与账单为准**。

官方定价来源：`https://www.volcengine.com/docs/82379/1544106`

| 模型 | 场景 | 分辨率 | 在线推理价格（元/百万 tokens） |
|------|------|--------|-------------------------------|
| `doubao-seedance-2-0-260128` | 无视频输入 | 480p / 720p | **46** |
| `doubao-seedance-2-0-260128` | 含视频输入 | 480p / 720p | **28** |
| `doubao-seedance-2-0-260128` | 无视频输入 | **1080p** | **51** |
| `doubao-seedance-2-0-260128` | 含视频输入 | **1080p** | **31** |
| `doubao-seedance-2-0-fast-260128` | 无视频输入 | 480p / 720p | **37** |
| `doubao-seedance-2-0-fast-260128` | 含视频输入 | 480p / 720p | **22** |
| `doubao-seedance-2-0-fast-260128` | — | 1080p | **不支持** |

MCP 返回的模型描述摘要：

- **Seedance 2.0**：新一代专业级多模态视频模型；支持图/视/音参考；具备编辑、延长等能力；面向广告、影视、社媒等场景。  
- **Seedance 2.0 fast**：继承 2.0 核心能力，**生成更快**。  
- **域与端点**：`domain: VideoGeneration`；`supported_endpoints` 含 `contents_generations`。  
- **输入/输出模态**：输入 `text` / `image` / `video` / `audio`，输出 `video`。

---

## 8. 提示词工程（方法论速查）

核心思想：**先叙事与约束，再编号指代参考，最后补镜头与不变量**。

### 8.1 基础公式

按顺序组织：

`主体/对象 + 动作/事件 + 场景/背景 + 风格/光影 + 镜头语言 + 音频/字幕/特效 +（编辑时的不变约束）`

### 8.2 多模态指代

- 素材按上传顺序对应 **`图片1`、`图片2`、`视频1`、`音频1`** …  
- 写清「参考什么属性」：如「构图参考图片1」「动作参考视频2」「氛围参考音频1」。  
- 避免只写「参考这张图」。

### 8.3 文字类

- **广告语**：内容 + 出现时机 + 位置 + 方式 + 颜色/风格。  
- **字幕**：位置 + 文案 + **与音频/口播同步**关系。  
- **气泡台词**：谁在说 + 台词 + 气泡形态。  
- 尽量用常用字，少生僻字与特殊符号。

### 8.4 视频参考三类

1. **动作参考**：参考哪段视频的哪些动作细节。  
2. **运镜参考**：参考推拉摇移跟等镜头运动，而非人物动作。  
3. **特效参考**：参考粒子、光效、轨迹等，并说明作用对象。

### 8.5 编辑 / 延长 / 轨道补齐（文档侧）

- **增删改**：写清时间/空间位置；删除/替换时强调 **其余内容保持不变**、**动作和运镜不变** 等。  
- **延长**：描述向前或向后延展内容，依赖模型衔接；不必重复描述整段原视频。  
- **轨道补齐**：多段视频衔接；官方文档曾给出 **最多 3 段、总时长不超过约 15 秒** 等限制描述——产品侧应在前端与文案中做上限提示。

### 8.6 本仓库内置片段与优化器

- `SEEDANCE_DOC_SNIPPETS`（`seedance-prompt-builder.ts`）：一键插入官方典型句式。  
- `/api/seedance/prompt-optimize`：在配置好通用 AI 时，用结构化 JSON 返回 `optimizedPrompt`、`issues`、`clarificationQuestions` 等；未配置则走本地 `buildSeedanceOptimizationFallback` 规则引擎。

---

## 9. 本仓库功能地图

| 能力 | 位置 |
|------|------|
| 创作台页面 | `src/app/(main)/seedance/page.tsx` → 路由 **`/seedance`** |
| 创建任务 / 列表 | `POST/GET /api/seedance/tasks` |
| 查询 / 删除任务 | `GET/DELETE /api/seedance/tasks/[taskId]` |
| 素材上传（签名 URL + 公网 URL） | `POST /api/seedance/assets`；Supabase 存储桶 **`seedance-assets`**，单文件上限 **500MB**，MIME 白名单见 `assets/route.ts` |
| 提示词优化 | `POST /api/seedance/prompt-optimize` |
| 方舟客户端封装 | `src/lib/ark-seedance.ts` |
| 参数与校验 | `src/lib/seedance-params.ts` |
| 费用估算 | `src/lib/seedance-pricing.ts` |
| 提示词拼装与场景检测 | `src/lib/seedance-prompt-builder.ts` |

### 9.1 登录与鉴权

上述 API 均要求用户已登录（本仓库使用 Supabase Auth）；创建任务时若未传 `safety_identifier`，服务端会用用户 ID 的哈希派生一段标识（见 `tasks/route.ts`）。

### 9.2 媒体 URL 形态（创建任务时）

本仓库接受：

- `https?://` 公网 URL  
- `asset://...` 项目约定资源引用  
- 部分 `data:image|video|audio/...;base64,...` Data URL  

具体校验在 `tasks/route.ts` 的 `isValidMediaUrl` 中。

---

## 10. 开发 checklist

- [ ] 配置 `ARK_API_KEY` 并确认方舟控制台已开通对应模型。  
- [ ] 首次使用上传：确认 Supabase 侧 `seedance-assets` 桶与策略可用。  
- [ ] 对照官方文档核对 **模型 ID** 是否仍为 `260128` 后缀版本。  
- [ ] 价格展示：上线前用官方价目表替换或校准 `seedance-pricing.ts`。  
- [ ] 需要最新 OpenAPI 时：使用 **Ark Docs MCP** 或文档中心 API 参考页。

---

## 11. 相关文件一览（仓库内）

- `SEEDANCE_2_PROMPT_GUIDE.md` — 提示词指南学习笔记（偏官方结构复述）  
- `docs/SEEDANCE-2-全面参考.zh-CN.md` — 本文档（产品 + API + 集成）  
- `src/lib/ark-seedance.ts`、`seedance-params.ts`、`seedance-pricing.ts`、`seedance-prompt-builder.ts`  
- `src/app/api/seedance/**`、`src/components/seedance-playground.tsx`、`seedance-prompt-dialog.tsx`

---

## 12. Ark Docs MCP 检索补充（须与控制台、官网实时核对）

以下条目来自 **火山 Ark Docs MCP**（远程知识库），用于补齐官网改版或本地笔记滞后时的要点。**若与控制台、实际接口返回冲突，以后者为准**。

### 12.1 教程总页要点（`ark_fetch_doc`: 视频生成）

官方教程页：[视频生成](https://www.volcengine.com/docs/82379/1366799?lang=zh)。

- **异步流程**：`POST /contents/generations/tasks` 返回任务 `id` → 轮询 `GET /contents/generations/tasks/{id}` 至 `succeeded`（或使用 Webhook）。成功后从 **`content.video_url`** 下载 MP4。  
- **合规（Danger）**：文档明确 **多模态素材禁止使用真人人脸**；写实风格可通过 **[虚拟人像库](https://www.volcengine.com/docs/82379/2223965?lang=zh)** 控制人像。  
- **文档自相矛盾提示**：同页顶部曾出现「Seedance 2.0 仅支持体验中心免费体验、**暂不支持 API**」类 **Warning**，但同页下文提供 **Curl / Python / Java / Go** 的 `doubao-seedance-2-0-260128` API 示例。实施前请以 **控制台模型开通状态、计费与接口可用性** 为准，勿仅依赖单段 Warning。  
- **Seedance 2.0 能力概述**（教程章节）：支持图/视/音/文输入；视频生成、**编辑**、**延长**；可继承参考图的角色与构图、参考视频的动作与运镜、参考音频的音色与节奏等。  
- **延长与轨道补齐（Tips）**：向前/向后延长「视频 n」+ 描述；多段视频用「视频1 + 过渡 + 视频2 …」衔接。延长时生成结果一般只含原片尾部画面，也可用提示词要求「最后接视频1」等灵活控制；2～3 段补全会包含原视频与新生成片段。

### 12.2 创建任务 API 文档摘录（`ark_search_docs` → 1520757）

以下摘自检索到的 [创建视频生成任务 API](https://www.volcengine.com/docs/82379/1520757?lang=zh) 片段，**完整约束请读原文**。

- **`resolution`**：`480p` / `720p` / **`1080p`**；**1080p 仅标准版支持，fast 版不支持**（接口与 UI 均已做模型级校验）。默认 **720p**。  
- **`ratio`**：支持 `16:9`、`4:3`、`1:1`、`3:4`、`9:16`、`21:9`、`adaptive`；**Seedance 2.0 & 2.0 fast 默认 `adaptive`**。文档含各分辨率下宽高像素对照表（2.0 与 1.x 列不同，实施抠表请以官网为准）。  
- **参数传入方式**：推荐在 **request body** 顶层传 `resolution` / `ratio` / `duration` 等（强校验）；旧式在 `text` 后追加 `--参数` 仍兼容但弱校验。  
- **`generate_audio`**：`boolean`，**默认 `true`**；文档写明 **仅 Seedance 2.0 & 2.0 fast、Seedance 1.5 pro 支持**。  
- **`tools`**：仅 **Seedance 2.0 & 2.0 fast**；目前类型为 **`web_search`**。**仅适用于纯文本输入**（与本文第 6 节、官方教程一致）。开启后模型自主决定是否检索；**时延会增加**。  
- **`return_last_frame`**：用于 **连续多段视频**（上一段尾帧作下一段首帧）等流程；详见教程内链说明。  
- **`service_tier`**：`default`（在线）与 `flex`（离线、价低）；文档注明 **Seedance 2.0 & 2.0 fast 不支持离线推理**（与 `flex` 相关描述以原文为准）。  
- **`execution_expires_after`**：任务超时秒数，默认 **172800（48h）**，取值范围文档写 **[3600, 259200]**。  

### 12.3 查询任务 API 摘录（`ark_search_docs` → 1521309）

- **`usage`**：视频生成模型 **不统计输入 token**（输入为 0），故 **`total_tokens` = `completion_tokens`**（文档说明）。  
- **`usage.tool_usage.web_search`**：开启联网搜索时，表示 **实际搜索次数**；为 **0** 表示未发生搜索。  
- **`human_face_mode`**：文档标注 **仅 Seedance 2.0 & 2.0 fast** 返回，表示本次请求实际使用的人脸处理模式。  
- **`safety_identifier`**：若创建任务时传入，查询结果 **原样带回**。  

### 12.4 合并 OpenAPI 的坑（`ark_get_spec` 实测）

对 `api_path: "/contents/generations/tasks"` 调用 `ark_get_spec` 时，返回的合并 Spec 可能出现 **「3D Generation」标签、`Create3DGenerationTaskRequest`** 等与**视频生成**文档不一致的描述。  
**结论**：集成时以 **[创建视频生成任务 API 文档](https://www.volcengine.com/docs/82379/1520757?lang=zh)** 与真实请求为准；OpenAPI 合并件仅作辅助，需人工甄别。

### 12.5 官方示例代码（`ark_search_examples`）

MCP 中可检索到与 **1366799** 等文档绑定的 **Curl / Python** 片段，例如：

- 纯文本 + `tools: [{ "type": "web_search" }]` 的 Curl 样例；  
- 文本 + `reference_image` + `reference_video` 的 Python SDK 编辑类任务样例。  

本地开发可先在 MCP 中搜 **`Seedance 2.0`** / **`contents/generations/tasks`** 再对照文档页码安装到工程。

### 12.6 官方提示词技能（检索命中说明）

`ark_search_docs` 会返回 **`skill://sd2-pe`**（Seedance 2.0 多模态提示词优化相关）的索引条目；具体安装包是否仍通过 `get_ark_skill_bundle('sd2-pe')` 提供，**以当时 MCP / 控制台 Skills 为准**（本次 `ark_get_skill("sd2-pe")` 返回未找到，可能已更名或需其他入口）。

---

## 13. 官方能力 / 文档 ↔ 本仓库视频创作台（`/seedance`）对照

对照范围：**火山文档 + 第 12 节 MCP 摘要** vs **当前 `SeedancePlayground` + `/api/seedance/*`**（以仓库实现为准，随迭代变化）。

### 13.1 已对齐或等价的能力

| 维度 | 官方 / 文档 | 本仓库现状 |
|------|-------------|------------|
| 创建与查询 | `POST/GET/DELETE` 同一路径 | `ark-seedance.ts` 与 `/api/seedance/tasks` 一致 |
| 模型 | `doubao-seedance-2-0-260128`、`-fast-260128` | 下拉仅这两项 |
| 多模态 content | `text` / `image_url` / `video_url` / `audio_url` + role | `buildContent()` 与 API 校验一致 |
| 首帧 / 首尾帧 | 与参考音视频互斥 | `ImageInputMode` + 前后端双重校验，与 `tasks/route.ts` 一致 |
| 参考数量上限 | 图 9 / 视频 3 / 音频 3 | `SEEDANCE_REFERENCE_LIMITS`，提交前 `validateSeedanceReferenceCounts` |
| 纯音频禁止 | 需配合图或视频 | 与官方产品约束一致 |
| `web_search` | 仅纯文本 | `enableWebSearch` + `canUseSeedanceWebSearch`，与 API 一致 |
| `generate_audio` | 默认 true | 默认勾选「输出声音」 |
| `return_last_frame` | 文档支持多段衔接 | 提供勾选；结果区展示尾帧并支持「作为下一段首帧」回填 |
| `watermark` | 文档支持 | 提供「保留水印」 |
| 时长 | 文档常见 4～15s；智能时长 | 支持预设、`duration=-1`、手动输入与校验 |
| 画幅 / 分辨率 | `ratio`、`resolution` | 可选含 `adaptive`；`480p`/`720p`/`1080p`（fast 版 1080p 置灰；切 fast 时自动降档） |
| `safety_identifier` | 可选 | 未在 UI 暴露；API 层用登录用户 ID 哈希自动填充 |
| 任务列表 | 支持分页 | `GET /api/seedance/tasks?pageNum&pageSize` + 历史区 |
| 素材上传 | 需可访问 URL | Supabase 签名上传 + 公网 URL，另支持手动粘贴 URL / Data URL（见 API） |
| 费用感知 | 价目与 usage | 预估（无视频参考时）+ 任务完成后按 `usageTokens` 估算；**已感知 1080p 独立价格**；标准版 1080p 单价 51/31，480p720p 46/28（无/含视频输入） |
| `seed` | 种子控参 | UI 已暴露；范围 `-1 ~ 2^32-1`；`-1` 或留空均为随机；结果区回显 `task.seed` |
| 查询结果 `frames`/`generateAudio`/`toolUsageWebSearch` | 接口返回 | `SeedanceTaskSummary` 已解析；任务详情格显示帧数（当接口返回 frames 时代替时长）、音频状态、联网搜索次数 |
| 任务列表 filter | 接口支持 `filter.status/task_ids/model/service_tier` | `listSeedanceTasks` + API 路由均已透传；`page_size` 上限 500 |
| 提示词辅助 | 官方指南 / sd2-pe | `SeedancePromptDialog` + `/api/seedance/prompt-optimize`（含本地 fallback） |
| 调试 | — | 「原始返回」展示 `task.raw` |

### 13.2 差异、未暴露或需知情的点

| 维度 | 说明 |
|------|------|
| **`ratio` 默认值** | 文档侧 Seedance 2.0 默认常为 **`adaptive`**；工作台默认选 **`16:9`**（仍可手动改 `adaptive`）。 |
| **`resolution` 是否必填** | 文档中部分示例省略；工作台**始终提交**当前所选（默认 720p），一般无妨。 |
| **`service_tier`（default / flex）** | 文档称 2.0 与 flex/离线关系以官网为准；工作台**不传**，走服务端默认。 |
| **`execution_expires_after`** | 文档可配 3600～259200 秒；工作台**不传**，走方舟默认（如 48h）。 |
| **`service_tier`（default / flex）** | 文档称 2.0 与 flex/离线关系以官网为准；工作台**不传**，走服务端默认。 |
| **`execution_expires_after`** | 文档可配 3600～259200 秒；工作台**不传**，走方舟默认（48h）。 |
| **`human_face_mode`** | 文档称查询结果可返回；**未解析展示**，看「原始返回」。 |
| **Webhook** | 教程支持回调；本仓库**仅轮询**（约 8s + 抖动，429 退避）。 |
| **合规提示** | 文档 **禁止多模态真人人脸**、建议虚拟人像库；工作台**无专门弹窗/文案**（依赖用户自觉 + 方舟侧策略）。 |
| **体验中心「暂不支持 API」类文案** | 与同页 API 示例可能冲突；**以你账号控制台是否可调用为准**。 |
| **旧式 `--duration` 写在 text 里** | 文档仍提弱校验旧方式；工作台**只用 body 顶层参数**，与推荐方式一致。 |

### 13.3 产品向小结

- 创作台已覆盖 **2.0 主线**：多模态参考、首尾帧模式、联网搜索（纯文）、尾帧衔接、水印、音频开关、seed、1080p（标准版）、历史 filter、任务详情含 frames/generateAudio/toolUsageWebSearch，以及 1080p 独立计费。  
- 残留小差异：**`human_face_mode`** 未解析展示；**`callback_url`/`execution_expires_after`/`service_tier`** 未在 UI 开放（用默认值）。  
- 若要与官方默认体验更一致：可考虑把 **默认画幅改为 `adaptive`**，或在首次进入时提示文档默认值含义。

---

**结语**：Seedance 2.0 的高质量结果，来自「清晰的叙事 + 明确的参考编号 + 可执行的约束」。本文档随仓库迭代维护；若你发现与火山官网不一致之处，**以官网与接口返回为准**，并欢迎同步更新本文件（含第 12 节的 MCP 检索日期与摘要）。
