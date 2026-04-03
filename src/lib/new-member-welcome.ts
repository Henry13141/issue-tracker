import { getPublicAppUrl } from "@/lib/app-url";
import { isWecomAppConfigured, sendWecomWorkNotice } from "@/lib/wecom";

function buildWelcomeMarkdown(displayName: string, appUrl: string): { title: string; markdown: string } {
  const loginUrl = appUrl ? `${appUrl}/login` : "";
  const lines = [
    "## 欢迎加入米伽米协作推进台",
    "",
    `**${displayName}**，你好！`,
    "",
    "公司已经启用 **米伽米 · 协作推进台**（内部工具），帮助团队一起把事情推进到位：",
    "",
    "- **记录与跟踪**：需求、问题、待办事项集中管理，每件事都有迹可循",
    "- **分工协作**：负责人明确，不用口头传达，不怕遗漏",
    "- **同步进展**：随时更新一句进展，团队就能了解最新情况",
    "- **接力提醒**：通过企业微信收到分配和进展通知，确保衔接顺畅",
    "",
  ];
  if (loginUrl) {
    lines.push(`### [点此打开系统 →](${loginUrl})`);
  } else {
    lines.push("请用**电脑浏览器**打开公司系统地址登录（若未显示链接请联系管理员配置站点域名）。");
  }
  lines.push(
    "",
    "- 首次使用请完成注册/登录，**姓名请填真实姓名**，便于同事识别",
    "- 日常有任务或问题请在系统里创建、认领，并及时更新进展",
    "- 遇到阻塞直接备注卡点，团队会更快帮你推进",
    "",
    "如有疑问请联系管理员郝毅。",
    "",
    "祝工作顺利，我们一起把事情做成！"
  );
  return { title: "欢迎加入 · 米伽米协作推进台", markdown: lines.join("\n") };
}

/**
 * 向新员工发送企业微信应用消息：欢迎 + 系统用途说明。
 * 不阻塞调用方；失败只打日志。
 */
export function notifyNewMemberWelcome(wecomUserid: string, displayName: string): void {
  const wc = wecomUserid?.trim();
  if (!wc) return;
  void (async () => {
    if (!isWecomAppConfigured()) return;
    const base = getPublicAppUrl();
    const { title, markdown } = buildWelcomeMarkdown((displayName || "同事").trim(), base);
    try {
      await sendWecomWorkNotice(wc, title, markdown);
    } catch (e) {
      console.error("[new-member-welcome] send failed:", e);
    }
  })();
}
