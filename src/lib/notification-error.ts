/**
 * 通知发送错误归一化
 *
 * 将企业微信原始错误码 / 消息归一化为内部统一的 error_code，
 * 同时保留完整 provider_response 用于原始审计。
 */

export type NormalizedErrorCode =
  | "invalid_userid"       // 企业微信 userid 不存在或未关注
  | "access_token_error"   // token 获取失败（配置错误或过期）
  | "ip_not_allowed"       // 服务器出站 IP 未加白
  | "rate_limited"         // 接口频率限制
  | "config_missing"       // 本地环境变量未配置
  | "provider_unknown_error"; // 其他未归类错误

export interface NormalizedError {
  code: NormalizedErrorCode;
  message: string;
  providerResponse: Record<string, unknown>;
}

/**
 * 将各种错误（企业微信 API / fetch 网络 / 环境变量缺失）归一化
 */
export function normalizeNotificationError(err: unknown): NormalizedError {
  // 提取原始错误信息
  const raw = err instanceof Error ? err.message : String(err);

  // 尝试从错误消息中解析企业微信 errcode
  const errcodeMatch = raw.match(/errcode[=:]?\s*(\d+)/i);
  const errcode = errcodeMatch ? parseInt(errcodeMatch[1], 10) : null;

  // 尝试提取 provider JSON（如果有的话）
  let providerResponse: Record<string, unknown> = { raw };
  try {
    // wecom API 错误包含原始 JSON 字符串时尝试解析
    const jsonStart = raw.indexOf("{");
    if (jsonStart !== -1) {
      providerResponse = {
        ...providerResponse,
        ...JSON.parse(raw.slice(jsonStart)),
      };
    }
  } catch {
    // ignore
  }

  // 企业微信 errcode 对照：https://developer.work.weixin.qq.com/document/path/90313
  if (errcode !== null) {
    // userid 无效
    if ([40003, 80001, 80004, 80005].includes(errcode)) {
      return { code: "invalid_userid", message: "企业微信 userid 无效或用户未关注企业", providerResponse };
    }
    // token 相关
    if ([40001, 40002, 41001, 42001, 42007, 42009].includes(errcode)) {
      return { code: "access_token_error", message: "Access Token 无效或已过期，请检查 WECOM_CORPSECRET", providerResponse };
    }
    // IP 白名单
    if ([60020, 60011].includes(errcode)) {
      return { code: "ip_not_allowed", message: "服务器 IP 未加入企业微信可信 IP 白名单", providerResponse };
    }
    // 频率限制
    if ([45009, 45015, 45016].includes(errcode)) {
      return { code: "rate_limited", message: "企业微信接口频率限制，请稍后重试", providerResponse };
    }
  }

  // 本地配置缺失（从错误消息检测）
  if (/未配置|not configured|missing|WECOM/i.test(raw)) {
    return { code: "config_missing", message: "企业微信相关环境变量未配置", providerResponse };
  }

  // IP 白名单（文字匹配）
  if (/ip.*not.*allow|not.*allow.*ip|ip.*白名单/i.test(raw)) {
    return { code: "ip_not_allowed", message: "服务器 IP 未加入企业微信可信 IP 白名单", providerResponse };
  }

  // fetch 网络层失败（Node.js undici 抛出 TypeError: fetch failed，真实原因在 cause）
  if (/fetch failed|network.*error|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET/i.test(raw)) {
    const cause = err instanceof Error ? (err as NodeJS.ErrnoException).cause : undefined;
    const causeMsg = cause instanceof Error ? cause.message
      : (cause != null && typeof cause === 'object' && 'message' in cause)
        ? String((cause as {message: unknown}).message)
        : undefined;
    const causeCode = (cause != null && typeof cause === 'object' && 'code' in cause)
      ? String((cause as {code: unknown}).code)
      : undefined;
    const detail = [causeCode, causeMsg].filter(Boolean).join(" ");
    return {
      code: "provider_unknown_error",
      message: `网络请求失败（fetch failed）${detail ? `: ${detail}` : ""}。请检查服务器出口网络是否可访问 qyapi.weixin.qq.com，或配置 WECOM_API_BASE_URL / WECOM_PROXY_URL 代理。`,
      providerResponse: { ...providerResponse, causeCode, causeMsg },
    };
  }

  return { code: "provider_unknown_error", message: raw.slice(0, 500), providerResponse };
}
