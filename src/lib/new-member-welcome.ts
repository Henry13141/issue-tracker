import { getPublicAppUrl } from "@/lib/app-url";
import { isWecomAppConfigured, sendWecomWorkNotice } from "@/lib/wecom";

function buildWelcomeMarkdown(displayName: string, appUrl: string): { title: string; markdown: string } {
  const loginUrl = appUrl ? `${appUrl}/login` : "";
  const lines = [
    "## 欢迎加入米伽米问题追踪系统",
    "",
    `**${displayName}**，你好！`,
    "",
    "公司已经启用 **米伽米 · 问题追踪系统**（内部工具），主要用来：",
    "",
    "- **记录与跟踪问题**：需求、缺陷、待办事项集中在一个列表里，方便查找与跟进",
    "- **指派与认领**：负责人明确，减少口头传达遗漏",
    "- **写进展与改状态**：随时更新进度，团队能看到最新情况",
    "- **提醒与协同**：通过企业微信接收指派、进度与每日提醒，减少漏跟",
    "",
  ];
  if (loginUrl) {
    lines.push(`### [点此打开系统 →](${loginUrl})`);
  } else {
    lines.push("请用**电脑浏览器**打开公司问题系统地址登录（若未显示链接请联系管理员配置站点域名）。");
  }
  lines.push(
    "",
    "- 首次使用请完成注册/登录，**姓名请填真实姓名**，便于同事识别",
    "- 日常有任务或问题请在系统里创建、认领，并及时更新状态",
    "- 收到提醒时请及时帮忙处理问题，遇到阻塞可直接备注卡点，团队会协同支持",
    "",
    "如有疑问请联系管理员郝毅。",
    "",
    "祝工作顺利！"
  );
  return { title: "欢迎加入 · 米伽米问题追踪系统", markdown: lines.join("\n") };
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
