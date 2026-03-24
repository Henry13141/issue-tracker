import { getMyReminders, getAllRemindersForAdmin } from "@/actions/reminders";
import { getCurrentUser } from "@/lib/auth";
import { RemindersClient } from "@/components/reminders-client";

export default async function RemindersPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const mine = await getMyReminders();
  const adminAll = user.role === "admin" ? await getAllRemindersForAdmin() : [];

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">提醒与日报</h1>
        <p className="text-sm text-muted-foreground">系统催办与超期提醒</p>
      </div>
      <RemindersClient mine={mine} adminAll={adminAll} user={user} />
    </div>
  );
}
