"use client";

/** Десктопное левое меню: разделы, счётчики, расхлоп настроек, меню пользователя. */

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";

import type { SettingsSectionView } from "@/lib/mock";

import {
  ChevronIcon,
  CommentsIcon,
  ContactsIcon,
  DashboardIcon,
  MessagesIcon,
  SettingsIcon,
} from "./icons";
import {
  QUERY_KEYS,
  SECTIONS,
  buildHref,
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
  comments: CommentsIcon,
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
  settingsSections: SettingsSectionView[];
};

export function Sidebar({
  workspaceName,
  workspaces,
  currentWorkspaceId,
  userName,
  userRole,
  messagesCounters,
  commentsCounters,
  settingsSections,
}: SidebarProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeSection = sectionIdForPathname(pathname);

  // Расхлоп остался только у «Настроек»: списки разделов больше не фильтруются
  // по каналам, экраны показывают записи всех каналов сразу.
  const [isSettingsOpen, setIsSettingsOpen] = useState(
    activeSection === "settings",
  );

  const activeSettingsSection = searchParams.get(QUERY_KEYS.section);

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

      <nav className={styles.nav}>
        {SECTIONS.map((section) => {
          const Icon = SECTION_ICONS[section.id];
          const isActive = activeSection === section.id;
          const count = sectionCounts[section.id];

          if (section.expandable) {
            // Клик по самому пункту (а не только по стрелке) схлопывает и
            // расхлопывает подменю и никуда не ведёт — раздел открывается
            // выбором подпункта.
            return (
              <div key={section.id}>
                <button
                  type="button"
                  className={`${styles.navItem} ${styles.navToggle}`}
                  data-active={isActive}
                  aria-expanded={isSettingsOpen}
                  onClick={() => setIsSettingsOpen((state) => !state)}
                >
                  <Icon />
                  <span className={styles.navLabel}>{section.label}</span>
                  <span className={styles.chevron} data-open={isSettingsOpen}>
                    <ChevronIcon />
                  </span>
                </button>

                {isSettingsOpen ? (
                  <div className={styles.subList}>
                    {settingsSections.map((settingsSection) => (
                      <Link
                        key={settingsSection.id}
                        className={styles.subItem}
                        data-active={
                          isActive &&
                          activeSettingsSection === settingsSection.id
                        }
                        href={buildHref(section.pathname, {
                          [QUERY_KEYS.section]: settingsSection.id,
                        })}
                      >
                        <span className={styles.subLabel}>
                          {settingsSection.title}
                        </span>
                      </Link>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          }

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
        <div className={styles.mockNote}>UI-каркас · mock-данные</div>
      </div>
    </aside>
  );
}
