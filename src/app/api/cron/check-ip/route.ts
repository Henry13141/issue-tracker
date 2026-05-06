import { NextResponse } from "next/server";
import { authorizeCronRequest } from "@/lib/cron-auth";

export async function GET(request: Request) {
  const auth = authorizeCronRequest(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const res = await fetch("https://api.ipify.org?format=json");
  const json = await res.json();
  return NextResponse.json({ outbound_ip: json.ip, hint: "把这个 IP 加到企业微信应用的可信 IP 白名单里" });
}
