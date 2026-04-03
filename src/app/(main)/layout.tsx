import { redirect } from "next/navigation";
import { MainAppShell } from "@/components/main-app-shell";
import { getCurrentUser } from "@/lib/auth";

export default async function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  return <MainAppShell user={user}>{children}</MainAppShell>;
}
