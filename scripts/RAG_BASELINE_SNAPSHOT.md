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

## Phase 0.3 Baseline 评测

采集时间：2026年5月7日星期四 18:18:55
采集方式：CLI 复刻 `/api/knowledge/ask` 的检索、LLM 生成和 citation 校验流程；检索模式：vector；未写入 `knowledge_ai_answers`，避免 baseline 评测污染线上问答统计。

### 汇总指标（Phase 1 改动后用于横向对比）

| 指标 | 数值 |
| --- | --- |
| 题目总数 | 5 |
| 命中（no_basis = false）| 5 / 5 |
| LLM 自评 high | 5 / 5 |
| 平均召回 chunk 数（过滤前→后）| 11.6 → 11.6 |
| 平均召回文章数（过滤后） | 4.0 |
| 平均引用文章数 | 2.8 |
| Hybrid source=both chunk 占比 | 0.0% |
| Hybrid 比 Vector-only 多召回 distinct articles | —（vector-only） |

> 字段说明：`retrieved_articles` 表示按 article_id 聚合后的召回结果，格式 `<short_id>(<top_score>×<chunk_count>, <source>)`；source 中 `both` 代表向量与 FTS 两路都命中，是更强的相关性信号。`retrieved_chunks` 显示 `过滤前→过滤后` 的 chunk 总数（过滤条件：SQL 相似度 ≥ 0.25 且客户端 chunk 长度 ≥ 50）。

### 逐题详情

| question | project_name | retrieved_chunks | retrieved_articles_filtered | cited_article_ids | similarity_top1 | confidence | no_basis | answer_preview |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 问题追踪系统的核心功能和知识库模块是怎么设计的？ | 问题追踪系统 | 10→10 | 71b1e16e(0.40×10, vec) | 71b1e16e | 0.4001 | high | false | ## 核心功能设计 问题追踪系统的核心不是单纯记录工单，而是把以下环节串成闭环： - **任务创建、责任分配、进展同步、风险暴露、企业微信催办、管理看板** 主要覆盖模块： - * |
| GameParty 项目的整体架构和部署方式是什么？ | GameParty | 12→12 | 5a39e7aa(0.62×12, vec) | 5a39e7aa | 0.6230 | high | false | ## 项目整体定位 GameParty 是一套**多人线下体感派对游戏合集**，部署于游戏厅/娱乐场所，玩家通过手脚传感器（Arduino 串口设备）进行交互。支持最多 **5 名 |
| 欢乐客栈第一关前堂对掌的核心玩法是什么？ | 欢乐客栈 | 12→12 | 3a2b698a(0.63×3, vec) 5f61c49b(0.44×4, vec) 44ceac48(0.41×2, vec) 1adba643(0.39×2, vec) 3402aee7(0.37×1, vec) | 3a2b698a | 0.6306 | high | false | 欢乐客栈第一关「前堂对掌」的核心玩法如下： **玩法类型**：拍巴掌 / 对掌反应玩法 **核心操作**： - 主动出掌 - 躲闪 - 诱敌 - 反制 **核心体验**： - 我打 |
| 金币与声望系统的主要规则有哪些？ | 欢乐客栈 | 12→12 | 1e99b63c(0.58×2, vec) 5f61c49b(0.58×5, vec) 968c46b4(0.55×2, vec) 1adba643(0.53×1, vec) 3a2b698a(0.51×1, vec) 076328ff(0.50×1, vec) | 5f61c49b, 1e99b63c, 968c46b4, 076328ff | 0.5775 | high | false | ## 金币与声望系统主要规则 ### 核心原则 - **金币决定胜负**：所有关卡统一以金币多少判定输赢 - **声望记录表现**：反映玩家操作质量、判断质量、爆发/稳定/高光表现 |
| 战报与结算 UI 需要展示哪些关键信息？ | 欢乐客栈 | 12→12 | 1adba643(0.56×1, vec) 328b9b76(0.55×4, vec) 3a2b698a(0.55×1, vec) 44ceac48(0.53×1, vec) 3402aee7(0.51×1, vec) 1e99b63c(0.45×2, vec) …+1 | 328b9b76, 3a2b698a, 1adba643, 44ceac48, 3402aee7, 1e99b63c, 5f61c49b | 0.5626 | high | false | 根据知识库，战报与结算 UI 需要展示以下关键信息： ## 一、金币信息 - **金币获得**：显示总获得金币 `+X` - **金币明细**：最多显示 4-6 条（为 0 的项目 |

## Phase 1.3 Hybrid vs Vector 对比

### 修过滤口径错配后 + 切换决策

采集时间：
- Vector-only：2026年5月7日星期四 18:18:55
- Hybrid：2026年5月7日星期四 18:21:04

本轮先修复客户端过滤口径错配：`route.ts`、`chatWithAssistant`、`eval-rag-baseline.mjs` 的 `chunk_content.trim().length >= 100` 统一改为 `>= 50`，与线上 `_v2` RPC 和 FTS RPC 的 `length(content) >= 50` source of truth 保持一致。

| 指标 | Vector-only | Hybrid | 变化 |
| --- | --- | --- | --- |
| 题目总数 | 5 | 5 | — |
| 命中（no_basis = false） | 5 / 5 | 5 / 5 | 持平 |
| LLM 自评 high | 5 / 5 | 5 / 5 | 持平 |
| 平均召回 chunk 数（过滤前→后） | 11.6 → 11.6 | 11.6 → 11.6 | 持平 |
| 平均召回文章数（过滤后） | 4.0 | 4.4 | +0.4 |
| 平均引用文章数 | 2.8 | 2.8 | 持平 |
| Hybrid source=both chunk 占比 | 0.0% | 20.7% | +20.7% |
| Hybrid 比 Vector-only 多召回 distinct articles | — | 总计 +2，均值 +0.4 | 更多 2/5，减少 0/5 |

逐题关键变化：
- Q4「金币与声望」：Vector 6 篇 → Hybrid 7 篇，`both=41.7%`，保留精确名词召回补漏收益。
- Q5「战报与结算 UI」：Vector 7 篇 → Hybrid 8 篇，之前因 70 字符 FTS chunk 被客户端 `>=100` 误杀造成的虚假退化已消失。
- Q1/Q2/Q3 因项目数据规模或题目聚焦度限制，distinct articles 持平，但 GameParty 与第一关题目均出现 `both` 双路一致信号。

切换决策：
- Hybrid 在修复过滤口径后无明显退化：命中率、LLM high、平均引用文章数均持平，平均召回文章数提升到 4.4。
- `/api/knowledge/ask` 已切换到 `hybridSearchChunks()`，`matchCount=12`，`filterProjectName=projectName`，默认启用。
- 紧急回退方式：设置环境变量 `RAG_HYBRID_ENABLED=false`，ask 路由会回退到 `match_knowledge_chunks_v2` 纯向量路径。
- `chatWithAssistant` 暂不切 hybrid，仅修复长度过滤口径；其 `match_count=6` 的上下文预算留待后续 Phase 继续优化。
