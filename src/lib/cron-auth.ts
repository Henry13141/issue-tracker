export type CronAuthResult =
  | { ok: true }
  | { ok: false; status: 401 | 503; error: string };

/**
 * Vercel Cron adds x-vercel-cron. Manual calls require CRON_SECRET.
 * If the secret is missing, do not allow anonymous manual execution.
 */
export function authorizeCronRequest(request: Request): CronAuthResult {
  if (request.headers.get("x-vercel-cron") === "1") {
    return { ok: true };
  }

  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return { ok: false, status: 503, error: "CRON_SECRET is not configured" };
  }

  const header = request.headers.get("authorization");
  if (header !== `Bearer ${secret}`) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }

  return { ok: true };
}
