import OpenAI from "openai";

let _client: OpenAI | null = null;

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

export async function chatCompletion(
  systemPrompt: string,
  userContent: string,
  opts?: { maxTokens?: number; disableThinking?: boolean },
): Promise<string | null> {
  const client = getClient();
  if (!client) return null;

  try {
    const res = await client.chat.completions.create({
      model: "kimi-k2.5",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
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
