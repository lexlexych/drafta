import type { ReactNode } from "react";
import { redirect } from "next/navigation";

import { getAuthenticatedUser, getCurrentWorkspace } from "@/lib/db/workspace";

export default async function DashboardLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const user = await getAuthenticatedUser();

  if (!user) {
    redirect("/login");
  }

  const workspace = await getCurrentWorkspace(user.id);

  if (!workspace) {
    redirect("/onboarding");
  }

  return children;
}
