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
  opts?: { maxTokens?: number },
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
    });
    return res.choices[0]?.message?.content ?? null;
  } catch (e) {
    console.error("[ai] chatCompletion failed:", e instanceof Error ? e.message : e);
    return null;
  }
}
