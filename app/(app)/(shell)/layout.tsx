import { Suspense, type ReactNode } from "react";
import { redirect } from "next/navigation";

import { getCommentsNavigationCounters } from "@/lib/db/comments-inbox";
import { getInboxNavigationCounters, listChannelConnections } from "@/lib/db/inbox";
import { createServerSupabaseClient } from "@/lib/db/server";
import {
  getAuthenticatedUser,
  getCurrentWorkspace,
  listUserWorkspaces,
} from "@/lib/db/workspace";
import { SETTINGS_SECTIONS } from "@/lib/mock";

import { InboxRealtimeSync } from "./_components/inbox-realtime-sync";
import { InstallPrompt } from "./_components/install-prompt";
import { PwaRegister } from "./_components/pwa-register";
import { Sidebar } from "./_components/sidebar";
import { Tabbar } from "./_components/tabbar";
import { Toast } from "./_components/stub";
import styles from "./_components/shell.module.css";

/**
 * Оболочка защищённой зоны: левое меню (десктоп) + нижний таббар (мобайл).
 *
 * Гейты: аутентификацию проверяет `app/(app)/layout.tsx`, наличие workspace —
 * этот layout (нет workspace → онбординг). Workspace и пользователь — реальные;
 * счётчики «Сообщения» (`lib/db/inbox.ts`, T-05) и «Комментарии»
 * (`lib/db/comments-inbox.ts`, этап 5) — реальные данные; «Дашборд» пока на
 * mock (вне скоупа). Список workspace'ов пользователя уходит в меню подвала
 * (`_components/user-menu.tsx`) — переключение и создание нового.
 * `InboxRealtimeSync` (T-06) держит те же счётчики и открытый инбокс живыми —
 * см. его собственный докстринг.
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

  const supabase = await createServerSupabaseClient();
  const channels = await listChannelConnections(supabase, workspace.id);
  const [messagesCounters, commentsCounters] = await Promise.all([
    getInboxNavigationCounters(supabase, workspace.id, channels),
    getCommentsNavigationCounters(supabase, workspace.id, channels),
  ]);
  // Кэшируется в том же запросе, что и `getCurrentWorkspace` — второго
  // обращения к БД здесь нет.
  const workspaces = await listUserWorkspaces(user.id);
  const userName = user.email?.split("@")[0] ?? "Пользователь";

  return (
    <div className={styles.app}>
      <Suspense>
        <Sidebar
          workspaceName={workspace.name}
          workspaces={workspaces.map((entry) => ({
            id: entry.id,
            name: entry.name,
          }))}
          currentWorkspaceId={workspace.id}
          userName={userName}
          userRole={workspace.role}
          messagesCounters={messagesCounters}
          commentsCounters={commentsCounters}
          settingsSections={SETTINGS_SECTIONS}
        />
      </Suspense>
      <div className={styles.main}>{children}</div>
      <Suspense>
        <Tabbar
          messagesCounters={messagesCounters}
          commentsCounters={commentsCounters}
        />
      </Suspense>
      <InboxRealtimeSync workspaceId={workspace.id} />
      <PwaRegister />
      <InstallPrompt />
      <Toast />
    </div>
  );
}
