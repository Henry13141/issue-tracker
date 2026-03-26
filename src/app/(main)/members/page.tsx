import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getMembers, getMemberWorkloadForPage, getNotificationCoverageForPage } from "@/actions/members";
import { isWecomWebhookConfigured } from "@/lib/wecom";
import { MembersClient } from "@/components/members-client";

export default async function MembersPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/issues");

  const [members, workload, coverage] = await Promise.all([
    getMembers(),
    getMemberWorkloadForPage(),
    getNotificationCoverageForPage(),
  ]);

  return (
    <MembersClient
      members={members}
      workload={workload}
      coverage={coverage}
      groupWebhookConfigured={isWecomWebhookConfigured()}
    />
  );
}
