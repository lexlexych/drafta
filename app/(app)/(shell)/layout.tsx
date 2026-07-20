import { Suspense, type ReactNode } from "react";
import { redirect } from "next/navigation";

import { getInboxNavigationCounters, listChannelConnections } from "@/lib/db/inbox";
import { createServerSupabaseClient } from "@/lib/db/server";
import { getAuthenticatedUser, getCurrentWorkspace } from "@/lib/db/workspace";
import { SETTINGS_SECTIONS, getNavigationCounters } from "@/lib/mock";

import { Sidebar } from "./_components/sidebar";
import { Tabbar } from "./_components/tabbar";
import { Toast } from "./_components/stub";
import styles from "./_components/shell.module.css";

/**
 * Оболочка защищённой зоны: левое меню (десктоп) + нижний таббар (мобайл).
 *
 * Гейты: аутентификацию проверяет `app/(app)/layout.tsx`, наличие workspace —
 * этот layout (нет workspace → онбординг). Workspace и пользователь — реальные;
 * пункт «Сообщения» (счётчик + расхлоп по каналам) — реальные данные
 * `lib/db/inbox.ts` (T-05); остальные счётчики и содержимое разделов —
 * mock-данные T-07 (Комментарии, Контакты, Дашборд — вне скоупа эпика).
 */
export default async function ShellLayout({
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

  const counters = getNavigationCounters();
  const supabase = await createServerSupabaseClient();
  const channels = await listChannelConnections(supabase, workspace.id);
  const messagesCounters = await getInboxNavigationCounters(
    supabase,
    workspace.id,
    channels,
  );
  const userName = user.email?.split("@")[0] ?? "Пользователь";

  return (
    <div className={styles.app}>
      <Suspense>
        <Sidebar
          workspaceName={workspace.name}
          userName={userName}
          userRole={workspace.role}
          counters={counters}
          messagesCounters={messagesCounters}
          settingsSections={SETTINGS_SECTIONS}
        />
      </Suspense>
      <div className={styles.main}>{children}</div>
      <Suspense>
        <Tabbar counters={counters} messagesCounters={messagesCounters} />
      </Suspense>
      <Toast />
    </div>
  );
}
