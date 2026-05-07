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

## Phase 0.3 Baseline 评测

采集时间：2026年5月7日星期四 16:49:56
采集方式：CLI 复刻 `/api/knowledge/ask` 的检索、LLM 生成和 citation 校验流程；未写入 `knowledge_ai_answers`，避免 baseline 评测污染线上问答统计。

| question | project_name | cited_article_ids | similarity_top1 | confidence | no_basis | answer_preview |
| --- | --- | --- | --- | --- | --- | --- |
| 问题追踪系统的核心功能和知识库模块是怎么设计的？ | 问题追踪系统 | 71b1e16e-9744-4f52-b6b6-3117e07a877a | 0.3979 | high | false | ## 核心功能 问题追踪系统的核心定位是**协作推进与问题跟踪闭环**，不是单纯的工单记录工具。主要功能模块包括： - **工单协作**：问题创建、指派、评审、状态流转、进展、附件 |
| GameParty 项目的整体架构和部署方式是什么？ | GameParty | 5a39e7aa-8604-4033-9453-64a776118b40 | 0.6230 | high | false | GameParty 是一套**多人线下体感派对游戏合集**，部署于游戏厅/娱乐场所，玩家通过手脚传感器（Arduino 串口设备）进行交互。 ## 核心架构 ### 技术栈 - * |
| 欢乐客栈第一关前堂对掌的核心玩法是什么？ | 欢乐客栈 | 3a2b698a-8b93-435a-b0b8-1f4959d71130, 60aae8f6-1cce-4d97-9137-856f72aa2ca7 | 0.6288 | high | false | 《欢乐客栈》第一关「前堂对掌」（又称《拍巴掌》）的核心玩法是**双人节奏博弈的实时对打**，具体要点如下： - **血量设定**：双方各有 5 滴血 - **核心操作**：拍击起跳 |
| 金币与声望系统的主要规则有哪些？ | 欢乐客栈 | 5f61c49b-3ef0-42a6-9392-d77c6fe8c9b5, 968c46b4-1b12-4989-83d5-ab98d21889f6 | 0.5775 | high | false | 金币与声望系统的主要规则如下： ## 核心原则 \| 规则 \| 说明 \| \|------\|------\| \| **金币决定胜负** \| 最终结算以金币高低判定输赢 \| \| **声望记 |
| 战报与结算 UI 需要展示哪些关键信息？ | 欢乐客栈 | 63303227-5fd6-48f4-86cf-42681b79509b | 0.6699 | high | false | 根据《欢乐客栈》战报信息设计总表，战报与结算 UI 需要展示以下 **10 项关键信息**： 1. **关卡标题** 2. **战报副标题** 3. **本局结果** 4. **胜 |
