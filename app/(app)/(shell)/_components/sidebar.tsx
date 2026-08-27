"use client";

/** Десктопное левое меню: разделы, счётчики, меню пользователя. */

import Link from "next/link";
import { usePathname } from "next/navigation";

import { LinkActivity } from "./activity";
import {
  ContactsIcon,
  DashboardIcon,
  MessagesIcon,
  PostsIcon,
  SettingsIcon,
} from "./icons";
import {
  SECTIONS,
  sectionIdForPathname,
  type InboxNavCounters,
  type SectionId,
} from "./navigation";
import styles from "./shell.module.css";
import uiStyles from "./ui.module.css";
import { UserMenu, type WorkspaceOption } from "./user-menu";

const SECTION_ICONS: Record<SectionId, typeof DashboardIcon> = {
  dashboard: DashboardIcon,
  inbox: MessagesIcon,
  comments: PostsIcon,
  contacts: ContactsIcon,
  settings: SettingsIcon,
};

export type SidebarProps = {
  workspaceName: string;
  workspaces: WorkspaceOption[];
  currentWorkspaceId: string;
  userName: string;
  userRole: string;
  /**
   * Real DM unread total (docs/epics/epic_02/T-05-inbox-messages.md,
   * `lib/db/inbox.ts`'s `getInboxNavigationCounters`) — бейдж пункта
   * «Сообщения».
   */
  messagesCounters: InboxNavCounters;
  /**
   * Real comment unread total (stage 5,
   * `lib/db/comments-inbox.ts`'s `getCommentsNavigationCounters`) — бейдж
   * пункта «Комментарии».
   */
  commentsCounters: InboxNavCounters;
};

export function Sidebar({
  workspaceName,
  workspaces,
  currentWorkspaceId,
  userName,
  userRole,
  messagesCounters,
  commentsCounters,
}: SidebarProps) {
  const pathname = usePathname();
  const activeSection = sectionIdForPathname(pathname);

  const sectionCounts: Record<SectionId, number> = {
    dashboard: 0,
    inbox: messagesCounters.totalUnread,
    comments: commentsCounters.totalUnread,
    contacts: 0,
    settings: 0,
  };

  return (
    <aside className={styles.sidebar}>
      <div className={styles.logo}>
        <div>
          <b>
            draf<i>ta</i>
          </b>
          <div className={styles.workspace}>{workspaceName} · workspace</div>
        </div>
      </div>

      {/* Ни один пункт не расхлопывается: разделы настроек — список на самом
          экране `/settings`, а не подменю. */}
      <nav className={styles.nav}>
        {SECTIONS.map((section) => {
          const Icon = SECTION_ICONS[section.id];
          const isActive = activeSection === section.id;
          const count = sectionCounts[section.id];

          return (
            <div key={section.id} className={styles.navItem} data-active={isActive}>
              <Link className={styles.navLink} href={section.pathname}>
                <Icon />
                <span className={styles.navLabel}>{section.label}</span>
                {count > 0 ? (
                  <span className={`${styles.navCount} ${uiStyles.num}`}>
                    {count}
                  </span>
                ) : null}
                <LinkActivity label={`Открываем «${section.label}»…`} />
              </Link>
            </div>
          );
        })}
      </nav>

      <div className={styles.sidebarFooter}>
        <UserMenu
          userName={userName}
          userRole={userRole}
          workspaces={workspaces}
          currentWorkspaceId={currentWorkspaceId}
        />
      </div>
    </aside>
  );
}
