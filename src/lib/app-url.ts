/**
 * 用于钉钉 Markdown 链接等场景。优先配置 NEXT_PUBLIC_APP_URL（生产域名，勿尾斜杠）。
 * 未配置时在 Vercel 上可用 VERCEL_URL。
 */
export function getPublicAppUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) {
    const host = vercel.replace(/^https?:\/\//, "");
    return `https://${host}`;
  }
  return "";
}

export function getIssueDetailUrl(issueId: string): string {
  const base = getPublicAppUrl();
  if (!base) return "";
  return `${base}/issues/${issueId}`;
}
