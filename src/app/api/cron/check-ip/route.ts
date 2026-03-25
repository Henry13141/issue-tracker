import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const res = await fetch("https://api.ipify.org?format=json");
  const json = await res.json();
  return NextResponse.json({ outbound_ip: json.ip, hint: "把这个 IP 加到企业微信应用的可信 IP 白名单里" });
}
