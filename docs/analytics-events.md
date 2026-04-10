# V3 产品优化 · Vercel Analytics 自定义事件

通过 `@vercel/analytics` 的 `track()` 上报（见 [src/lib/product-analytics.ts](../src/lib/product-analytics.ts)）。

| 事件名 | 触发时机 | 属性 |
|--------|----------|------|
| `quick_issue_update_submit` | 快速写进展弹窗提交成功 | `source`: `my_tasks` / `issue_detail` / `reminders` |
| `dashboard_intervention_click` | 管理驾驶舱「今日建议优先干预」内链接点击 | `target`: `intervention_issue:<uuid>` 或 `intervention_nav_overdue` / `intervention_nav_blocked` / `intervention_nav_notif_failed` |

说明：需在 Vercel 项目开启 Web Analytics 后，在控制台查看自定义事件聚合。
