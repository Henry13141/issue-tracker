# Uptime Kuma 建议监控项

在 `https://status.megami-tech.com` 完成初始化后，按下面添加 Monitor（路径以你实际域名为准）。

| 名称 | 类型 | 目标 | 说明 |
|------|------|------|------|
| Tracker 首页 | HTTP(s) | `https://tracker.megami-tech.com` | 期望 200 |
| 企微扫码入口 | HTTP(s) | `https://tracker.megami-tech.com/api/auth/wecom/start` | 可能 302 或 503；在 Kuma 里勾选「接受 302」或设合法状态码 |
| Squid 本机端口 | TCP | `host.docker.internal` : `3128` | Kuma 容器已配置 `host.docker.internal` 指向宿主机 |
| 企微 API | HTTP(s) | `https://qyapi.weixin.qq.com` | 可选；仅测连通性 |
| Supabase REST | HTTP(s) | `https://<project-ref>.supabase.co/rest/v1/` | 可能 401 无 key 属正常，可改为只测根域或 Dashboard |

## 企业微信告警

Settings → Notifications → 添加 **Webhook**，URL 填你的企微群机器人地址。  
若希望告警也走本机中转，可把 URL 换成 `https://hook.megami-tech.com/relay/wecom`（需按机器人文档构造 JSON 正文）。
