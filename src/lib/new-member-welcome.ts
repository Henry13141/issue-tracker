import { sendLifecycleNotification } from "@/lib/notification-service";

function buildWelcomeMarkdown(displayName: string): { title: string; markdown: string } {
  const lines = [
    `**${displayName}**，欢迎加入！`,
    "",
    "公司用「米伽米·协作推进台」一起跟进工作：",
    "· 任务、问题集中管理，分工明确不遗漏",
    "· 更新一句进展，团队就能了解最新情况",
    "· 企业微信自动收到提醒，衔接更顺畅",
    "",
    "首次使用请在电脑端登录，姓名填真实姓名。",
    "遇到问题联系管理员郝毅。",
    "",
    "祝工作顺利，一起把事情做成 💪",
  ];
  return { title: "欢迎加入 · 米伽米协作推进台", markdown: lines.join("\n") };
}

/**
 * 向新员工发送企业微信应用消息：欢迎 + 系统用途说明。
 * 通过 notification-service 统一发送，留有审计日志与重试能力。
 * 不阻塞调用方；失败只打日志。
 */
export function notifyNewMemberWelcome(wecomUserid: string, displayName: string): void {
  const wc = wecomUserid?.trim();
  if (!wc) return;
  void (async () => {
    const { title, markdown } = buildWelcomeMarkdown((displayName || "同事").trim());
    try {
      await sendLifecycleNotification({
        targetWecomUserid: wc,
        title,
        content: markdown,
      });
    } catch (e) {
      console.error("[new-member-welcome] send failed:", e);
    }
  })();
}
