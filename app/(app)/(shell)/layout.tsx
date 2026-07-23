import { Suspense, type ReactNode } from "react";
import { redirect } from "next/navigation";

import { getCommentsNavigationCounters } from "@/lib/db/comments-inbox";
import { getContactNavigationCounters } from "@/lib/db/contacts";
import { getInboxNavigationCounters, listChannelConnections } from "@/lib/db/inbox";
import { createServerSupabaseClient } from "@/lib/db/server";
import { getAuthenticatedUser, getCurrentWorkspace } from "@/lib/db/workspace";
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
 * счётчики «Сообщения» (`lib/db/inbox.ts`, T-05), «Комментарии»
 * (`lib/db/comments-inbox.ts`, этап 5) и «Контакты» (`lib/db/contacts.ts`,
 * этап 7) — реальные данные; «Дашборд» пока на mock (вне скоупа).
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
  const [messagesCounters, commentsCounters, contactsCounters] = await Promise.all([
    getInboxNavigationCounters(supabase, workspace.id, channels),
    getCommentsNavigationCounters(supabase, workspace.id, channels),
    getContactNavigationCounters(supabase, workspace.id, channels),
  ]);
  const userName = user.email?.split("@")[0] ?? "Пользователь";

  return (
    <div className={styles.app}>
      <Suspense>
        <Sidebar
          workspaceName={workspace.name}
          userName={userName}
          userRole={workspace.role}
          messagesCounters={messagesCounters}
          commentsCounters={commentsCounters}
          contactsCounters={contactsCounters}
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
