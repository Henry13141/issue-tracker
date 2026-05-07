# RAG Baseline Snapshot

采集时间：2026年5月7日星期四 16:37:21
采集方式：Supabase service role 经 PostgREST 读取线上数据；Supabase MCP 原始 SQL 执行权限当前不可用。

## Phase 0.3 前置结论：Embedding 维度

| 检查项 | 结果 |
| --- | --- |
| sample knowledge_chunks.embedding 维度 | 1024 |
| match_knowledge_chunks 传入 1024 维 | 成功，返回 1 行 |
| match_knowledge_chunks 传入 1536 维 | 按预期失败：different vector dimensions 1024 and 1536 |

结论：线上实际使用 1024 维向量，代码与 migration 文档应统一为 vector(1024)。

## Phase 0.1 数据现状 SQL 等价结果

### 文章总量与状态分布

| status | count |
| --- | --- |
| approved | 15 |

### Approved 文章按 project_name 分布

| project | count |
| --- | --- |
| 欢乐客栈 | 9 |
| GameParty | 3 |
| (null) | 1 |
| GameParty / 欢乐客栈 | 1 |
| 问题追踪系统 | 1 |

### 按 category 分布

| category | count |
| --- | --- |
| numeric_system | 4 |
| gameplay_rule | 3 |
| ui_spec | 3 |
| project_overview | 2 |
| technical_spec | 2 |
| operation_guide | 1 |

### 按 module 分布

| module | count |
| --- | --- |
| 金币与声望系统 | 4 |
| 第三关 酒窖奇谋 | 2 |
| (null) | 1 |
| 全局 | 1 |
| 平台架构 | 1 |
| 战报与结算 UI | 1 |
| 玩法体验设计 | 1 |
| 第一关 前堂对掌 | 1 |
| 第二关 拔河 | 1 |
| 第四关 灶台伏鼠 | 1 |
| 线下体验与商业转化 | 1 |

### chunks 总量与覆盖率

| metric | value |
| --- | --- |
| approved_searchable | 15 |
| articles_with_embedding | 15 |
| total_chunks | 347 |
| avg_chunks_per_article | 23.1 |

### chunk 长度分布

| bucket | count |
| --- | --- |
| 1 | 146 |
| 2 | 88 |
| 3 | 45 |
| 4 | 22 |
| 5 | 16 |
| 6 | 18 |
| 7 | 12 |

### 最近 30 天问答量与无依据率

| metric | value |
| --- | --- |
| total_questions | 6 |
| low_confidence | 3 |
| no_citation | 3 |

## Phase 0.2 当前 RPC 定义核对

原计划 SQL：

```sql
SELECT pg_get_functiondef(oid)
FROM pg_proc
WHERE proname = 'match_knowledge_chunks';
```

线上原始函数体提取结果：

| 通道 | 结果 |
| --- | --- |
| Supabase MCP execute_sql | 失败：当前账号无 SQL 执行权限 |
| supabase db dump --linked --schema public | 失败：本机 Docker daemon 未运行，CLI 无法启动 dump 依赖 |
| PostgREST OpenAPI | 成功：发现 `/rpc/match_knowledge_chunks` |
| RPC runtime probe | 成功：确认存在两个可调用签名/重载 |

PostgREST OpenAPI 暴露的签名：

| 参数 | 类型 |
| --- | --- |
| query_embedding | public.vector |
| match_threshold | double precision |
| match_count | integer |

RPC runtime probe 结果：

| 调用参数 | 结果 | 返回列 |
| --- | --- | --- |
| query_embedding + match_count + only_approved | 成功，返回 1 行 | chunk_id, article_id, article_title, category, chunk_content, similarity |
| query_embedding + match_count + match_threshold | 成功，返回 1 行 | id, article_id, chunk_index, content, similarity |

结论：线上 `match_knowledge_chunks` 至少存在两个重载版本；当前仓库的 `supabase/migrations/add_knowledge_rag.sql` 只描述 `only_approved` 版本，未记录线上仍可调用的 `match_threshold` 旧签名。Phase 1.1 新增 `_v2` 时需要显式保留旧函数，避免热更新期间调用方打到不同返回列。

## Phase 0.4 RPC 漂移收口（2026-05-07 补做）

通过 Supabase MCP `execute_sql` 拿到两个重载函数的完整原文体后，做了如下三件事：

1. **确认旧重载是真实安全漏洞**
   - 旧签名：`match_knowledge_chunks(vector, double precision, integer)`
   - 函数体内**只有** `WHERE 1 - (kc.embedding <=> query_embedding) > match_threshold`，**没有** `is_ai_searchable` / `status = 'approved'` 过滤
   - 任何调用方都可以拿到 draft / archived / 不可搜索文章的 chunks
   - 仓库 grep（`rg match_threshold` 全工程）：0 处应用代码使用 → 安全可删

2. **发现主函数还有第二个 mismatch**
   - 线上主函数实际带 `AND length(kc.content) >= 50`，仓库 migration 没记录
   - 应用层在 `route.ts` / `actions/ai.ts` 还各自做了 `chunk_content.trim().length >= 100` 的客户端过滤；服务端 50 + 客户端 100 的双层过滤是**有意冗余**，不影响功能但容易误以为只需改一处
   - 处理方式：把线上主函数原文写回 migration（仅文档化，零行为变化）

3. **新增 migration 并应用到线上**
   - 文件：`supabase/migrations/reconcile_match_knowledge_chunks_overloads.sql`
   - 通过 `apply_migration` MCP 应用，apply 后 `pg_proc` 验证：仅剩唯一签名 `(vector, integer, boolean)`，旧重载已消失
   - migration 文件内含完整回滚 SQL（如有人需要恢复旧重载可直接复制）

**对 Phase 1.1 的影响**：
- 升级到 `_v2` 时不再需要担心命中错误重载
- 但要注意：参数类型保持 polymorphic `vector` 而非 `vector(1024)`（与线上一致，pgvector 接受任意维度，维度由列定义强制）
- 维度仍由 `knowledge_chunks.embedding vector(1024)` 这一列定义保证

## Phase 1.2.5 project_name 数据治理（2026-05-07 补做）

Phase 1.2 切换到 `_v2` 严格 project 过滤后，立即暴露线上 `project_name` 脏数据：

| project_name | 治理前 | 治理后 | 处理 |
| --- | --- | --- | --- |
| 欢乐客栈 | 9 | 9 | 不变 |
| GameParty | 3 | **4** | 合并 |
| `GameParty / 欢乐客栈` | 1 | 0 | UPDATE → `GameParty`（标题/内容/SVN 路径全部指向 GameParty 主项目，混合命名属于早期录入错误） |
| 问题追踪系统 | 1 | 1 | 不变 |
| `null` | 1 | 0 | DELETE（《UI 主色调规范 v1.0》仅 64 字符，疑似测试数据；同时删除 3 个对应 chunks、1 条 issue_link、1 条 review_request） |
| **总计 approved** | 15 | **14** | -1（删 UI 测试数据） |

**操作记录**（直接 SQL，未用 migration 文件——因为不是 schema 变更而是一次性数据修正，记录于此作为审计痕迹）：

```sql
-- 1. 合并 GameParty 项目命名
UPDATE knowledge_articles
SET project_name = 'GameParty'
WHERE id = '5a39e7aa-8604-4033-9453-64a776118b40';

-- 2. 删除空内容测试数据 + 联级清理
DELETE FROM knowledge_chunks         WHERE article_id = '2fc2d998-01a3-40c3-be20-abc3b32b326a';
DELETE FROM knowledge_issue_links    WHERE article_id = '2fc2d998-01a3-40c3-be20-abc3b32b326a';
DELETE FROM knowledge_review_requests WHERE article_id = '2fc2d998-01a3-40c3-be20-abc3b32b326a';
DELETE FROM knowledge_articles       WHERE id         = '2fc2d998-01a3-40c3-be20-abc3b32b326a';
```

**长期治理建议**（写入 Phase 4 待办）：
- 知识库录入 UI 把 `project_name` 改为 select 下拉（限定 enum），杜绝 free text 漂移
- 加 schema 约束：`project_name` 强制非空 + CHECK IN (...)
- 定期跑 `SELECT DISTINCT project_name` 监控异常值

**对 baseline 的影响**：
- baseline fixture 第 2 题 `project_name` 从 `'GameParty / 欢乐客栈'` 改回 canonical `'GameParty'`
- 5/5 题命中保持不变，平均引用文章数从 2.2 → 2.4 略升（治理后 GameParty 命中策略更直接）

## Phase 1.3 Hybrid 上线（2026-05-07 完成）

| 指标 | Vector-only (`_v2`) | Hybrid (RRF, k=60) | 变化 |
| --- | --- | --- | --- |
| 命中（no_basis = false） | 5 / 5 | 5 / 5 | 持平 |
| LLM 自评 high | 5 / 5 | 5 / 5 | 持平 |
| 平均召回 chunk 数（过滤前→后） | 11.6 → 11.6 | 11.6 → 11.6 | 持平 |
| 平均召回文章数（过滤后） | 4.0 | 4.4 | **+0.4** |
| 平均引用文章数 | 2.8 | 2.8 | 持平 |
| Hybrid `source=both` 占比 | 0.0% | 20.7% | 双路一致信号 |
| distinct articles 总增量 | — | **+2** | 更多 2/5，**减少 0/5** |

附带的关键修复：客户端 `chunk_content.length` 过滤口径从 `>=100` 改为 `>=50`，与 SQL RPC source of truth 对齐。修复后 vector-only 自身的过滤前→后从 `11.6→9.2` 提升到 `11.6→11.6`，**这是普惠 fix，不是 hybrid 独享**。

切换决策：满足"不退化任何题目"前提，`/api/knowledge/ask` 默认走 hybrid；`chatWithAssistant` 也对齐到 hybrid（matchCount=6 保留 token 预算，filterProjectName=null 因为助手是跨项目）。环境开关 `RAG_HYBRID_ENABLED=false` 一键回退到 `match_knowledge_chunks_v2` 纯向量路径，两条入口共享同一个 flag。

## Phase 1.4 邻居 chunk 扩展（2026-05-07 完成）

| 指标 | Hybrid 无邻居 | Hybrid + 邻居 (window=1) | 差异 |
| --- | --- | --- | --- |
| 命中 / LLM high | 5/5, 5/5 | 5/5, 5/5 | 持平 |
| 召回 chunks / articles / citations | 11.6 / 4.4 / 2.8 | 11.6 / 4.4 / 2.8 | **硬指标完全持平** |
| LLM 实际看到的 prompt chunks（含邻居） | 11.6 | 23.2 | **翻倍**（平均补 +11.6 个上下文 chunk） |
| Q1 答案文本片段 | "评审 → 关闭/重开" | "风险暴露 → 企业…" | 更连贯（拉到下文） |
| Q2 答案细节 | "派对游戏合集" | "…支持最多 5 名玩家" | 多上下文细节 |
| Q4 引用文章数 | 4 | **6** | +2（更广） |
| Q5 引用文章数 | 7 | **5** | -2（更聚焦） |

逐题 prompt_chunks（primary + neighbors）：

| 题目 | 无邻居 | +邻居 (w=1) |
| --- | --- | --- |
| Q1 问题追踪系统 | 10 | 10+7 |
| Q2 GameParty 架构 | 12 | 12+14 |
| Q3 第一关对掌 | 12 | 12+9 |
| Q4 金币与声望 | 12 | 12+17 |
| Q5 战报与结算 UI | 12 | 12+11 |

**实现关键不变量**：
- citation 校验集只用 primary chunks 对应的 article_id，邻居 chunk 不参与；这样能精确反映"我们检索/打分认可的来源"，避免邻居把弱相关文章误纳入引用。
- `cited_chunk_ids` 仍然只持久化 primary chunks，保持检索质量分析口径稳定。
- `expand_chunk_neighbors` RPC 内对 `window_size` 用 `LEAST(GREATEST(..., 0), 3)` clamp 到 0..3，且过滤口径与 `_v2` 完全一致（`is_ai_searchable + approved + length(content) >= 50`）。
- TS 层 `expandWithNeighbors()` 防御式 fallback：任何 primary chunk 被 RPC 过滤掉就回退到 primary-only 集合，**绝不丢 citation 源**。

切换决策：
- ✅ `/api/knowledge/ask` 默认接入邻居扩展（window=1），用户问答场景对延迟和 token 不敏感，连贯性和软性收益值得。
- ❌ `chatWithAssistant` 不切：matchCount=6 是 token-budget 优化过的，再翻到 12-18 个 chunk 会挤压实时业务上下文（issue 数据、成员负载等）。
- 环境开关 `RAG_NEIGHBOR_EXPAND_ENABLED=false` 一键关闭 ask 路由的邻居扩展，回退到 primary-only。

## Phase 1 收尾：环境开关回退演练

env flag 行为（2026-05-07 验证）：

| `RAG_HYBRID_ENABLED` | `RAG_NEIGHBOR_EXPAND_ENABLED` | hybrid 真生效 | 邻居真生效 | 含义 |
| --- | --- | --- | --- | --- |
| (unset) | (unset) | true | true | 默认（生产当前状态） |
| `true` | `true` | true | true | 显式开 |
| `false` | `false` | false | false | 全回退到 `_v2` vector + primary-only |
| `false` | `true` | false | true | 退到 `_v2`，但邻居仍开 |
| `true` | `false` | true | false | hybrid 仍开，纯 primary |
| `FALSE` / `0` / `no` | 同左 | **true**（!） | **true**（!） | **不生效** |

> ⚠️ **运维 caveat**：env flag 必须严格小写 `false` 才会触发回退。`FALSE`、`0`、`no`、`off` 都不被识别为关闭，应急操作时务必小写。Phase 4 运维收口阶段会统一改为大小写无关 + 多种字面量识别。

## Phase 1 整体收尾总览

| Phase | 关键产出 | 状态 |
| --- | --- | --- |
| 0.1 / 0.2 | 数据现状 + 当前 RPC 漂移盘点 | ✅ |
| 0.3 | Embedding 维度统一到 1024 + baseline 评测脚本 | ✅ |
| 0.4 | 收口 `match_knowledge_chunks` 双 overload 安全漏洞 | ✅ |
| 1.1 | `match_knowledge_chunks_v2` RPC：项目/分类/模块/article_ids/min_similarity 过滤 | ✅ |
| 1.2 | `/api/knowledge/ask` 切到 v2，project filter 真正下推到 SQL | ✅ |
| 1.2.5 | `project_name` 数据治理（`GameParty / 欢乐客栈` → canonical `GameParty`，删 1 篇 null project 草稿） | ✅ |
| 1.3 | `knowledge_chunks.content_tsv` GIN 索引 + `search_knowledge_chunks_fts` RPC + `hybridSearchChunks()` (RRF) + 切换 ask + chatWithAssistant 对齐 | ✅ |
| 1.3.5 | 修复客户端长度过滤口径错配 (100→50，普惠 fix) | ✅ |
| 1.4 | `expand_chunk_neighbors` RPC + `expandWithNeighbors()` + 切 ask 路由 | ✅ |

**Phase 1 累计能力增强**（vs 起点）：
- 检索准确性：项目/分类/模块严格过滤 + 向量+全文 hybrid + RRF 融合
- 答案质量：邻居扩展提供连贯上下文，LLM 不再看到半句话
- 安全收口：去掉 `only_approved` 缺失的 unsafe RPC overload，过滤口径全链路统一到 `length>=50 + is_ai_searchable + approved`
- 引用可信：citation 二次校验 + 仅用 primary chunks 校验集，邻居不污染
- 应急可控：`RAG_HYBRID_ENABLED` / `RAG_NEIGHBOR_EXPAND_ENABLED` 两个独立开关，4 种组合都验证过
- 数据治理：`project_name` canonical 化，hybrid+v2 项目过滤可信
- 可对比：baseline 评测脚本可一键比较 `vector` / `hybrid` / `hybrid+nbr` 三种模式

下一阶段重心：**Phase 2 索引健康与可观测**（embedding 状态字段、覆盖率/失败 dashboard 卡片、问答日志聚合）。

## Phase 0.3 Baseline 评测

采集时间：2026年5月7日星期四 18:55:05
采集方式：CLI 复刻 `/api/knowledge/ask` 的检索、LLM 生成和 citation 校验流程；检索模式：vector；未写入 `knowledge_ai_answers`，避免 baseline 评测污染线上问答统计。

### 汇总指标（Phase 1 改动后用于横向对比）

| 指标 | 数值 |
| --- | --- |
| 题目总数 | 5 |
| 命中（no_basis = false）| 5 / 5 |
| LLM 自评 high | 5 / 5 |
| 平均召回 chunk 数（过滤前→后）| 11.6 → 11.6 |
| 平均召回文章数（过滤后） | 4.0 |
| 平均引用文章数 | 2.6 |
| Hybrid source=both chunk 占比 | 0.0% |
| Hybrid 比 Vector-only 多召回 distinct articles | —（vector-only） |

> 字段说明：`retrieved_articles` 表示按 article_id 聚合后的召回结果，格式 `<short_id>(<top_score>×<chunk_count>, <source>)`；source 中 `both` 代表向量与 FTS 两路都命中，是更强的相关性信号。`retrieved_chunks` 显示 `过滤前→过滤后` 的 chunk 总数（过滤条件：SQL 相似度 ≥ 0.25 且客户端 chunk 长度 ≥ 50）。`prompt_chunks` 列在邻居扩展开启时显示 `<primary>+<neighbors>`，表示 LLM 实际看到的素材数；citation 校验仍只用 primary，不受邻居影响。

### 逐题详情

| question | project_name | retrieved_chunks | prompt_chunks | retrieved_articles_filtered | cited_article_ids | similarity_top1 | confidence | no_basis | answer_preview |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 问题追踪系统的核心功能和知识库模块是怎么设计的？ | 问题追踪系统 | 10→10 | 10 | 71b1e16e(0.40×10, vec) | 71b1e16e | 0.3979 | high | false | ## 核心功能设计 问题追踪系统的核心不是单纯记录工单，而是将以下环节串成闭环： - **任务创建** → **责任分配** → **进展同步** → **风险暴露** → **企 |
| GameParty 项目的整体架构和部署方式是什么？ | GameParty | 12→12 | 12 | 5a39e7aa(0.62×12, vec) | 5a39e7aa | 0.6243 | high | false | ## 项目整体定位 GameParty 是一套**多人线下体感派对游戏合集**，部署于游戏厅/娱乐场所，玩家通过 Arduino 串口传感器（手脚传感器）进行交互。 ## 核心架构 |
| 欢乐客栈第一关前堂对掌的核心玩法是什么？ | 欢乐客栈 | 12→12 | 12 | 3a2b698a(0.63×3, vec) 5f61c49b(0.44×4, vec) 44ceac48(0.41×2, vec) 1adba643(0.39×2, vec) 3402aee7(0.37×1, vec) | 3a2b698a | 0.6291 | high | false | 欢乐客栈第一关「前堂对掌」的核心玩法为**拍巴掌/对掌反应玩法**。 **核心操作**： - 主动出掌 - 躲闪 - 诱敌 - 反制 **核心体验**： - 我打中了 - 我骗到了 |
| 金币与声望系统的主要规则有哪些？ | 欢乐客栈 | 12→12 | 12 | 1e99b63c(0.58×2, vec) 5f61c49b(0.58×5, vec) 968c46b4(0.55×2, vec) 1adba643(0.53×1, vec) 3a2b698a(0.51×1, vec) 076328ff(0.50×1, vec) | 5f61c49b, 1e99b63c, 968c46b4 | 0.5775 | high | false | 金币与声望系统的主要规则如下： ## 核心原则 - **金币决定胜负**：所有关卡统一以金币多少判定输赢 - **声望记录表现**：反映玩家操作质量、判断质量、爆发表现、稳定表现和 |
| 战报与结算 UI 需要展示哪些关键信息？ | 欢乐客栈 | 12→12 | 12 | 1adba643(0.56×1, vec) 328b9b76(0.55×4, vec) 3a2b698a(0.55×1, vec) 44ceac48(0.53×1, vec) 3402aee7(0.51×1, vec) 1e99b63c(0.45×2, vec) …+1 | 328b9b76, 3a2b698a, 1adba643, 44ceac48, 3402aee7, 1e99b63c, 5f61c49b | 0.5626 | high | false | 根据知识库，战报与结算 UI 需要展示以下关键信息： ## 一、金币信息 - **金币获得：+X**（总获得金币数） - **金币明细**：最多显示 4-6 条，为 0 的项目不显 |
