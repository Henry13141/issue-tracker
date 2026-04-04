"use client";

import { useEffect, useState } from "react";
import { Cloud, Droplets, Loader2, Sparkles, Wind } from "lucide-react";
import { cn } from "@/lib/utils";
import type { WeatherTipsRequestBody } from "@/types/weather-tips";

type WeatherIdle = { status: "idle" | "loading" };
type WeatherOk = {
  status: "ok";
  city: string;
  temp: number;
  min: number;
  max: number;
  label: string;
  emoji: string;
  humidity: number;
  windSpeed: number;
  windDir: string;
  tomorrow: {
    dateLabel: string;
    min: number;
    max: number;
    label: string;
    emoji: string;
  } | null;
};
type WeatherUnavailable = { status: "unavailable"; message: string };
type WeatherState = WeatherIdle | WeatherOk | WeatherUnavailable;

/** 上海浦东（陆家嘴一带）近似坐标 — Open-Meteo 网格预报 */
const SHANGHAI_PUDONG = {
  lat: 31.2304,
  lon: 121.4737,
  label: "上海浦东",
} as const;

function greetingForHour(hour: number): string {
  if (hour >= 0 && hour < 6) return "夜深了，注意休息";
  if (hour < 9) return "早上好";
  if (hour < 12) return "上午好";
  if (hour < 14) return "中午好";
  if (hour < 18) return "下午好";
  return "晚上好";
}

function chinaHour(): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    hour: "numeric",
    hour12: false,
  }).formatToParts(new Date());
  return Number(parts.find((p) => p.type === "hour")?.value ?? 12);
}

/** 上海日历日 YYYY-MM-DD，用于温馨提示「每天只生成一次」 */
function shanghaiCalendarDateKey(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const d = parts.find((p) => p.type === "day")?.value;
  return `${y ?? "1970"}-${m ?? "01"}-${d ?? "01"}`;
}

const WARM_TIP_STORAGE_KEY = "issue-tracker.weatherWarmTip.v1";

function readCachedWarmTip(todayKey: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(WARM_TIP_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { date?: string; tip?: string };
    if (parsed.date === todayKey && typeof parsed.tip === "string" && parsed.tip.trim()) {
      return parsed.tip.trim();
    }
  } catch {
    /* ignore */
  }
  return null;
}

function writeCachedWarmTip(todayKey: string, tip: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(WARM_TIP_STORAGE_KEY, JSON.stringify({ date: todayKey, tip }));
  } catch {
    /* quota / private mode */
  }
}

function formatDateLabelCN(isoDate: string): string {
  const d = new Date(`${isoDate}T12:00:00+08:00`);
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(d);
}

function fallbackWarmTip(w: WeatherOk): string {
  const t = w.tomorrow;
  if (!t) return "关注气温变化，劳逸结合，保持好状态。";
  const spread = t.max - t.min;
  if (t.label.includes("雨") || t.label.includes("阵雨") || t.label.includes("毛毛雨"))
    return "明日可能有雨，出门记得带伞，路上注意安全。";
  if (spread >= 10) return "明日昼夜温差较大，可采用洋葱式穿衣，方便增减。";
  if (t.max >= 32) return "明日气温偏高，注意补水与防晒，避免长时间暴晒。";
  if (t.max <= 8) return "明日体感偏冷，注意保暖，别着凉。";
  return "明日天气已更新，合理安排出行，照顾好自己。";
}

function OkWeather({ weather }: { weather: WeatherOk }) {
  return (
    <div className="grid gap-4 xl:grid-cols-2 xl:gap-5">
      <div className="rounded-xl border bg-muted/20 p-3 sm:p-4">
        <p className="mb-2 text-xs font-medium text-muted-foreground">今日 · {weather.city}</p>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <span className="text-4xl leading-none sm:text-[2.75rem]" aria-hidden>
              {weather.emoji}
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0">
                <span className="text-3xl font-semibold tabular-nums tracking-tight">{weather.temp}°C</span>
                <span className="text-sm tabular-nums text-muted-foreground">
                  {weather.min}° / {weather.max}°
                </span>
              </div>
              <p className="mt-1 text-sm font-medium">{weather.label}</p>
            </div>
          </div>
          <div className="flex shrink-0 flex-col gap-1.5 text-xs text-muted-foreground sm:items-end sm:text-right">
            <span className="inline-flex items-center gap-1.5">
              <Wind className="h-3.5 w-3.5 shrink-0" />
              {weather.windDir}风 {weather.windSpeed} m/s
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Droplets className="h-3.5 w-3.5 shrink-0" />
              湿度 {weather.humidity}%
            </span>
          </div>
        </div>
      </div>

      {weather.tomorrow ? (
        <div className="rounded-xl border border-dashed bg-muted/15 p-3 sm:p-4">
          <p className="mb-2 text-xs font-medium text-muted-foreground">明日 · {weather.tomorrow.dateLabel}</p>
          <div className="flex items-start gap-3">
            <span className="text-3xl leading-none sm:text-4xl" aria-hidden>
              {weather.tomorrow.emoji}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{weather.tomorrow.label}</p>
              <p className="mt-0.5 tabular-nums text-sm text-muted-foreground">
                {weather.tomorrow.min}° / {weather.tomorrow.max}°
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function chinaDateLine(): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date());
}

function wmoToLabel(code: number): { label: string; emoji: string } {
  if (code === 0) return { label: "晴朗", emoji: "☀️" };
  if (code <= 3) return { label: "多云", emoji: "⛅" };
  if (code <= 48) return { label: "雾", emoji: "🌫️" };
  if (code <= 57) return { label: "毛毛雨", emoji: "🌦️" };
  if (code <= 67) return { label: "雨", emoji: "🌧️" };
  if (code <= 77) return { label: "雪", emoji: "❄️" };
  if (code <= 82) return { label: "阵雨", emoji: "🌧️" };
  if (code <= 86) return { label: "阵雪", emoji: "🌨️" };
  if (code <= 99) return { label: "雷暴", emoji: "⛈️" };
  return { label: "未知", emoji: "🌤️" };
}

function degToDir(deg: number): string {
  const dirs = ["北", "东北", "东", "东南", "南", "西南", "西", "西北"];
  const i = Math.round(deg / 45) % 8;
  return dirs[i] ?? "—";
}

async function fetchWeather(lat: number, lon: number, cityLabel: string): Promise<WeatherState> {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    current: "temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m,wind_direction_10m",
    daily: "weather_code,temperature_2m_max,temperature_2m_min",
    forecast_days: "2",
    timezone: "Asia/Shanghai",
  });
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
  if (!res.ok) return { status: "unavailable", message: "天气服务暂时不可用" };
  const json = (await res.json()) as {
    current?: {
      temperature_2m: number;
      relative_humidity_2m: number;
      weather_code: number;
      wind_speed_10m: number;
      wind_direction_10m: number;
    };
    daily?: {
      time: string[];
      weather_code: number[];
      temperature_2m_max: number[];
      temperature_2m_min: number[];
    };
  };
  const cur = json.current;
  const daily = json.daily;
  if (!cur) return { status: "unavailable", message: "未获取到天气数据" };
  const { label, emoji } = wmoToLabel(cur.weather_code);

  const tMax0 = daily?.temperature_2m_max?.[0];
  const tMin0 = daily?.temperature_2m_min?.[0];
  const max = tMax0 ?? cur.temperature_2m;
  const min = tMin0 ?? cur.temperature_2m;

  let tomorrow: WeatherOk["tomorrow"] = null;
  const t1 = daily?.time?.[1];
  const code1 = daily?.weather_code?.[1];
  const tMax1 = daily?.temperature_2m_max?.[1];
  const tMin1 = daily?.temperature_2m_min?.[1];
  if (t1 !== undefined && code1 !== undefined && tMax1 !== undefined && tMin1 !== undefined) {
    const t1Info = wmoToLabel(code1);
    tomorrow = {
      dateLabel: formatDateLabelCN(t1),
      min: Math.round(tMin1),
      max: Math.round(tMax1),
      label: t1Info.label,
      emoji: t1Info.emoji,
    };
  }

  return {
    status: "ok",
    city: cityLabel,
    temp: Math.round(cur.temperature_2m),
    min: Math.round(min),
    max: Math.round(max),
    label,
    emoji,
    humidity: Math.round(cur.relative_humidity_2m),
    windSpeed: Math.round(cur.wind_speed_10m * 10) / 10,
    windDir: degToDir(cur.wind_direction_10m),
    tomorrow,
  };
}

function buildTipsPayload(w: WeatherOk): WeatherTipsRequestBody {
  const windText = `${w.windDir}风 ${w.windSpeed} m/s`;
  const tm = w.tomorrow;
  return {
    location: w.city,
    today: {
      condition: w.label,
      tempNow: w.temp,
      high: w.max,
      low: w.min,
      humidity: w.humidity,
      windText,
    },
    tomorrow: {
      dateLabel: tm?.dateLabel ?? "明日",
      condition: tm?.label ?? "未知",
      high: tm?.max ?? w.max,
      low: tm?.min ?? w.min,
    },
  };
}

export function WeatherWidget({ tenureDays }: { tenureDays: number }) {
  const [weather, setWeather] = useState<WeatherState>({ status: "idle" });
  const [warmTip, setWarmTip] = useState<string | null>(null);
  const [tipLoading, setTipLoading] = useState(false);
  const hour = chinaHour();
  const greet = greetingForHour(hour);

  useEffect(() => {
    setWeather({ status: "loading" });
    void (async () => {
      try {
        const w = await fetchWeather(SHANGHAI_PUDONG.lat, SHANGHAI_PUDONG.lon, SHANGHAI_PUDONG.label);
        setWeather(w);
        if (w.status !== "ok") return;

        const todayKey = shanghaiCalendarDateKey();
        const cached = readCachedWarmTip(todayKey);
        if (cached) {
          setWarmTip(cached);
          return;
        }

        setTipLoading(true);
        setWarmTip(null);
        try {
          const res = await fetch("/api/weather-tips", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(buildTipsPayload(w)),
          });
          const data = (await res.json()) as { tip?: string | null };
          if (res.ok && data.tip?.trim()) {
            const t = data.tip.trim();
            setWarmTip(t);
            writeCachedWarmTip(todayKey, t);
          } else {
            const fb = fallbackWarmTip(w);
            setWarmTip(fb);
            writeCachedWarmTip(todayKey, fb);
          }
        } catch {
          const fb = fallbackWarmTip(w);
          setWarmTip(fb);
          writeCachedWarmTip(todayKey, fb);
        } finally {
          setTipLoading(false);
        }
      } catch {
        setWeather({ status: "unavailable", message: "天气加载失败" });
      }
    })();
  }, []);

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{greet}</h1>
        <p className="text-sm text-muted-foreground">{chinaDateLine()}</p>
        <p className="text-sm text-muted-foreground">
          你已经在米伽米入职{" "}
          <span className="font-semibold tabular-nums text-foreground">{tenureDays}</span> 天
        </p>
      </header>

      <div
        className={cn(
          "overflow-hidden rounded-xl border bg-muted/10 text-sm shadow-none",
          weather.status === "unavailable" && "border-dashed",
        )}
      >
        {weather.status === "idle" || weather.status === "loading" ? (
          <div className="flex items-center gap-2 px-4 py-6 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>正在获取天气…</span>
          </div>
        ) : weather.status === "unavailable" ? (
          <div className="flex items-start gap-2 px-4 py-4 text-muted-foreground">
            <Cloud className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{weather.message}</span>
          </div>
        ) : weather.status === "ok" ? (
          <div className="space-y-0">
            <div className="p-3 sm:p-4">
              <OkWeather weather={weather} />
            </div>
            <div className="border-t border-primary/15 bg-primary/[0.06] px-3 py-3 sm:px-4 sm:py-3.5">
              <div className="mb-1.5 flex items-center gap-2 text-sm font-medium text-primary">
                <Sparkles className="h-4 w-4 shrink-0" />
                温馨提示
              </div>
              {tipLoading ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>正在生成温馨提示…</span>
                </div>
              ) : warmTip ? (
                <p className="max-w-prose text-pretty leading-relaxed text-foreground/90">{warmTip}</p>
              ) : (
                <p className="text-muted-foreground">—</p>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
