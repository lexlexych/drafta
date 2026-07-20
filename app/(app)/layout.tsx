import type { ReactNode } from "react";
import { redirect } from "next/navigation";

import { getAuthenticatedUser } from "@/lib/db/workspace";

export default async function AppLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const user = await getAuthenticatedUser();

  if (!user) {
    redirect("/login");
  }

  return children;
}
