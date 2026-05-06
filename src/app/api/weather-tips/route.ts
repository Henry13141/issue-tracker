import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { chatCompletion, isAIConfigured } from "@/lib/ai";
import type { WeatherTipsRequestBody } from "@/types/weather-tips";

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  let body: WeatherTipsRequestBody;
  try {
    body = (await req.json()) as WeatherTipsRequestBody;
  } catch {
    return NextResponse.json({ error: "无效请求体" }, { status: 400 });
  }

  if (!body?.today || !body?.tomorrow || !body?.location) {
    return NextResponse.json({ error: "缺少天气参数" }, { status: 400 });
  }

  if (!isAIConfigured()) {
    return NextResponse.json({ tip: null, skipped: "no_api_key" as const });
  }

  const systemPrompt = `你是米伽米协作推进台里的「天气小助手」。根据用户提供的今日与明日天气（地点已给定），写 2～4 句简短、温暖、适合职场的温馨提示（简体中文）。
要求：
- 口语自然，像同事之间的关怀，正能量、不鸡汤堆砌；
- 可结合气温变化提醒增减衣物、出行与带伞、防风保暖或防暑，但不要编造数据中不存在的预警；
- 不要分点列表，不要标题，不要 Markdown；
- 不要输出 emoji 或特殊符号；
- 总字数在 90 字以内。`;

  const userContent = [
    `地点：${body.location}`,
    `今日：${body.today.condition}，当前约 ${body.today.tempNow}°C，今日气温 ${body.today.low}～${body.today.high}°C，湿度约 ${body.today.humidity}%，${body.today.windText}`,
    `明日（${body.tomorrow.dateLabel}）：${body.tomorrow.condition}，${body.tomorrow.low}～${body.tomorrow.high}°C`,
    "请直接输出温馨提示正文，不要其他说明。",
  ].join("\n");

  const tip = await chatCompletion(systemPrompt, userContent, { maxTokens: 220, disableThinking: true });

  return NextResponse.json({ tip, skipped: tip ? undefined : ("empty" as const) });
}
