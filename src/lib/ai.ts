import OpenAI from "openai";

let _client: OpenAI | null = null;
const ARK_EMBEDDING_URL = "https://ark.cn-beijing.volces.com/api/v3/embeddings/multimodal";
const ARK_EMBEDDING_MODEL = "doubao-embedding-vision-251215";

/** 知识库检索相似度阈值（统一常量，避免各处不一致） */
export const MIN_KNOWLEDGE_SIMILARITY = 0.25;

export type AIChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export const WECOM_INTERNAL_ASSISTANT_SYSTEM_PROMPT = [
  "你是米伽米内部企业助手，服务对象是公司成员。",
  "请始终使用简体中文回答，先给结论，再给必要的下一步建议。",
  "回答要专业、直接、简洁，尽量控制在 1 到 5 个短段落或短列表内。",
  "当问题涉及工单、问题导入、负责人、状态推进、提醒时，优先按当前工单系统语境回答。",
  "如果用户询问如何导入问题，请明确说明：与机器人单聊发送 Excel 文件即可导入。",
  "如果用户要求清空记忆或重置上下文，应提醒可发送“清空上下文”或“重置对话”。",
  "不要编造公司制度、权限、数据或系统状态；不确定时直接说明不知道，并给出可执行建议。",
  "不要输出思维链，不要自我介绍，不要使用空泛套话。",
].join("\n");

function getClient(): OpenAI | null {
  const key = process.env.MOONSHOT_API_KEY;
  if (!key) return null;
  if (!_client) {
    _client = new OpenAI({
      apiKey: key,
      baseURL: "https://api.moonshot.cn/v1",
    });
  }
  return _client;
}

export function isAIConfigured(): boolean {
  return Boolean(process.env.MOONSHOT_API_KEY);
}

export async function chatCompletionFromMessages(
  messages: AIChatMessage[],
  opts?: { maxTokens?: number; disableThinking?: boolean },
): Promise<string | null> {
  const client = getClient();
  if (!client) return null;

  try {
    const res = await client.chat.completions.create({
      model: "kimi-k2.6",
      messages,
      max_tokens: opts?.maxTokens ?? 1024,
      ...(opts?.disableThinking ? { thinking: { type: "disabled" as const } } : {}),
    });
    const content = res.choices[0]?.message?.content?.trim();
    if (!content) {
      const finishReason = res.choices[0]?.finish_reason;
      const hasReasoning = Boolean(
        (res.choices[0]?.message as { reasoning_content?: string } | undefined)?.reasoning_content,
      );
      console.warn("[ai] empty completion content", { finishReason, hasReasoning });
      return null;
    }
    return content;
  } catch (e) {
    console.error("[ai] chatCompletion failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

export async function chatCompletion(
  systemPrompt: string,
  userContent: string,
  opts?: { maxTokens?: number; disableThinking?: boolean },
): Promise<string | null> {
  return chatCompletionFromMessages(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ],
    opts
  );
}

/**
 * 生成文本的向量嵌入（1024 维）。
 * 使用火山方舟 doubao-embedding-vision-251215，输出维度与 knowledge_chunks.embedding vector(1024) 匹配。
 * 需要配置环境变量 ARK_API_KEY。
 */
export async function createEmbedding(text: string): Promise<number[] | null> {
  const arkKey = process.env.ARK_API_KEY;
  if (!arkKey) {
    console.error("[ai] createEmbedding: ARK_API_KEY not configured");
    return null;
  }
  try {
    const res = await fetch(ARK_EMBEDDING_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${arkKey}`,
      },
      body: JSON.stringify({
        model: ARK_EMBEDDING_MODEL,
        input: [{ type: "text", text: text.slice(0, 4000) }],
        dimensions: 1024,
        encoding_format: "float",
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "(no body)");
      console.error(`[ai] Ark embedding ${res.status}:`, errText);
      return null;
    }

    // Ark multimodal embedding returns data as an object, not an array.
    // The multimodal endpoint ignores the `dimensions` param and may return 2048 dims;
    // truncate to 1024 to match knowledge_chunks.embedding vector(1024).
    const json = await res.json() as { data?: { embedding?: number[] } };
    const full = json.data?.embedding ?? null;
    if (!full) return null;
    return full.length > 1024 ? full.slice(0, 1024) : full;
  } catch (e) {
    console.error("[ai] createEmbedding failed:", e instanceof Error ? e.message : String(e));
    return null;
  }
}
