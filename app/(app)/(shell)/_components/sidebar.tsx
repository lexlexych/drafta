"use client";

/** Десктопное левое меню: разделы, счётчики, расхлопы по каналам и настройкам. */

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";

import type { ChannelPlatform } from "@/lib/channels/types";
import type { NavigationCountersView, SettingsSectionView } from "@/lib/mock";

import { Avatar } from "./avatar";
import { PlatformDot } from "./chips";
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

const SECTION_ICONS: Record<SectionId, typeof DashboardIcon> = {
  dashboard: DashboardIcon,
  inbox: MessagesIcon,
  comments: CommentsIcon,
  contacts: ContactsIcon,
  settings: SettingsIcon,
};

export type SidebarProps = {
  workspaceName: string;
  userName: string;
  userRole: string;
  counters: NavigationCountersView;
  /**
   * Real per-channel DM unread counts (docs/epics/epic_02/T-05-inbox-messages.md,
   * `lib/db/inbox.ts`'s `getInboxNavigationCounters`) — drives the
   * "Сообщения" nav item and its channel expand specifically. Every other
   * section (Комментарии, Контакты, Дашборд) still reads `counters`
   * (mock, E-001/T-07) — out of scope for this ticket (epic E-002 "Вне
   * скоупа").
   */
  messagesCounters: InboxNavCounters;
  /**
   * Real per-channel comment unread counts (stage 5,
   * `lib/db/comments-inbox.ts`'s `getCommentsNavigationCounters`) — drives the
   * "Комментарии" nav item and its channel expand.
   */
  commentsCounters: InboxNavCounters;
  settingsSections: SettingsSectionView[];
};

type SubListChannel = {
  id: string;
  name: string;
  platform: ChannelPlatform;
  count: number;
};

export function Sidebar({
  workspaceName,
  userName,
  userRole,
  counters,
  messagesCounters,
  commentsCounters,
  settingsSections,
}: SidebarProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeSection = sectionIdForPathname(pathname);

  const [expanded, setExpanded] = useState<Record<SectionId, boolean>>({
    dashboard: false,
    inbox: true,
    comments: false,
    contacts: false,
    settings: false,
    [activeSection]: true,
  });

  const activeChannelId = searchParams.get(QUERY_KEYS.channel);
  const activeSettingsSection =
    searchParams.get(QUERY_KEYS.section) ?? settingsSections[0]?.id;

  const sectionCounts: Record<SectionId, number> = {
    dashboard: 0,
    inbox: messagesCounters.totalUnread,
    comments: commentsCounters.totalUnread,
    contacts: 0,
    settings: 0,
  };

  function channelCount(sectionId: SectionId, channelId: string): number {
    const channel = counters.channels.find((entry) => entry.id === channelId);

    if (!channel) {
      return 0;
    }

    // Only "Контакты" still reads mock per-channel counts; inbox and comments
    // use their real counters in `subListChannelsFor`.
    return channel.contactCount;
  }

  function subListChannelsFor(sectionId: SectionId): SubListChannel[] {
    if (sectionId === "inbox") {
      return messagesCounters.channels.map((channel) => ({
        id: channel.id,
        name: channel.name,
        platform: channel.platform,
        count: channel.unreadCount,
      }));
    }

    if (sectionId === "comments") {
      return commentsCounters.channels.map((channel) => ({
        id: channel.id,
        name: channel.name,
        platform: channel.platform,
        count: channel.unreadCount,
      }));
    }

    return counters.channels.map((channel) => ({
      id: channel.id,
      name: channel.name,
      platform: channel.platform,
      count: channelCount(sectionId, channel.id),
    }));
  }

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
          const isOpen = expanded[section.id];
          const count = sectionCounts[section.id];

          return (
            <div key={section.id}>
              <div className={styles.navItem} data-active={isActive}>
                <Link className={styles.navLink} href={section.pathname}>
                  <Icon />
                  <span className={styles.navLabel}>{section.label}</span>
                  {count > 0 ? (
                    <span className={`${styles.navCount} ${uiStyles.num}`}>
                      {count}
                    </span>
                  ) : null}
                </Link>
                {section.expandable ? (
                  <button
                    type="button"
                    className={styles.chevron}
                    data-open={isOpen}
                    aria-expanded={isOpen}
                    aria-label={`Развернуть «${section.label}»`}
                    onClick={() =>
                      setExpanded((state) => ({
                        ...state,
                        [section.id]: !state[section.id],
                      }))
                    }
                  >
                    <ChevronIcon />
                  </button>
                ) : null}
              </div>

              {section.expandable && isOpen && section.id !== "settings" ? (
                <div className={styles.subList}>
                  <Link
                    className={styles.subItem}
                    data-active={isActive && !activeChannelId}
                    href={section.pathname}
                  >
                    <PlatformDot platform="all" />
                    <span className={styles.subLabel}>Все каналы</span>
                  </Link>
                  {subListChannelsFor(section.id).map((channel) => (
                    <Link
                      key={channel.id}
                      className={styles.subItem}
                      data-active={isActive && activeChannelId === channel.id}
                      href={buildHref(section.pathname, {
                        [QUERY_KEYS.channel]: channel.id,
                      })}
                    >
                      <PlatformDot platform={channel.platform} />
                      <span className={styles.subLabel}>{channel.name}</span>
                      {channel.count > 0 ? (
                        <span className={`${styles.subCount} ${uiStyles.num}`}>
                          {channel.count}
                        </span>
                      ) : null}
                    </Link>
                  ))}
                </div>
              ) : null}

              {section.id === "settings" && isOpen ? (
                <div className={styles.subList}>
                  {settingsSections.map((settingsSection) => (
                    <Link
                      key={settingsSection.id}
                      className={styles.subItem}
                      data-active={
                        isActive && activeSettingsSection === settingsSection.id
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
        })}
      </nav>

      <div className={styles.sidebarFooter}>
        <div className={styles.user}>
          <Avatar
            avatar={{ initials: userName.slice(0, 1).toUpperCase(), hue: 170 }}
            size="sm"
          />
          <div className={styles.userInfo}>
            <b>{userName}</b>
            <span>{userRole}</span>
          </div>
        </div>
        <div className={styles.mockNote}>UI-каркас · mock-данные</div>
      </div>
    </aside>
  );
}
