"use client";

/** Мобильный нижний таббар: те же разделы иконками, со счётчиками-бейджами. */

import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  CommentsIcon,
  ContactsIcon,
  DashboardIcon,
  MessagesIcon,
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

const SECTION_ICONS: Record<SectionId, typeof DashboardIcon> = {
  dashboard: DashboardIcon,
  inbox: MessagesIcon,
  comments: CommentsIcon,
  contacts: ContactsIcon,
  settings: SettingsIcon,
};

export function Tabbar({
  messagesCounters,
  commentsCounters,
}: {
  /** Real total DM unread (T-05) — see `SidebarProps.messagesCounters`. */
  messagesCounters: InboxNavCounters;
  /** Real total comment unread (stage 5) — see `SidebarProps.commentsCounters`. */
  commentsCounters: InboxNavCounters;
}) {
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
    <nav className={styles.tabbar}>
      {SECTIONS.map((section) => {
        const Icon = SECTION_ICONS[section.id];
        const count = sectionCounts[section.id];

        return (
          <Link
            key={section.id}
            href={section.pathname}
            className={styles.tabButton}
            data-active={activeSection === section.id}
          >
            <Icon size={22} />
            <span>{section.label}</span>
            {count > 0 ? (
              <span className={`${styles.tabCount} ${uiStyles.num}`}>{count}</span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
