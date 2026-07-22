/** Маршруты защищённой зоны и сборка ссылок с фильтрами. */

import type { ChannelPlatform } from "@/lib/channels/types";

/**
 * Real per-channel unread counts for the "Сообщения" nav item (T-05,
 * docs/epics/epic_02/T-05-inbox-messages.md) — `lib/db/inbox.ts` (server-only)
 * returns this shape, `Sidebar`/`Tabbar` (client components) declare it here
 * instead of importing the server module's type directly, same convention
 * `channels-panel.tsx` uses for `lib/db/channel-connections.ts` (T-04): a
 * small parallel client-side type, not a cross-boundary import of a
 * `"server-only"`-marked module.
 */
export type InboxNavChannelCounter = {
  id: string;
  name: string;
  platform: ChannelPlatform;
  unreadCount: number;
};

export type InboxNavCounters = {
  totalUnread: number;
  channels: InboxNavChannelCounter[];
};

/**
 * Real per-channel contact counts for the "Контакты" nav item (этап 7,
 * `lib/db/contacts.ts`'s `getContactNavigationCounters`). Same client-side
 * parallel-type convention as `InboxNavCounters` above — no cross-boundary
 * import of the `"server-only"` module.
 */
export type ContactsNavChannelCounter = {
  id: string;
  name: string;
  platform: ChannelPlatform;
  contactCount: number;
};

export type ContactsNavCounters = {
  channels: ContactsNavChannelCounter[];
};

export type SectionId =
  | "dashboard"
  | "inbox"
  | "comments"
  | "contacts"
  | "settings";

export type SectionDescriptor = {
  id: SectionId;
  label: string;
  pathname: string;
  /** Пункт раскрывается в подсписок каналов или разделов настроек. */
  expandable: boolean;
};

export const SECTIONS: SectionDescriptor[] = [
  { id: "dashboard", label: "Дашборд", pathname: "/dashboard", expandable: false },
  { id: "inbox", label: "Сообщения", pathname: "/inbox", expandable: true },
  { id: "comments", label: "Комментарии", pathname: "/comments", expandable: true },
  { id: "contacts", label: "Контакты", pathname: "/contacts", expandable: true },
  { id: "settings", label: "Настройки", pathname: "/settings", expandable: true },
];

export const QUERY_KEYS = {
  channel: "channel",
  category: "category",
  conversation: "conversation",
  contact: "contact",
  section: "section",
} as const;

export function sectionIdForPathname(pathname: string): SectionId {
  const section = SECTIONS.find(
    (candidate) =>
      pathname === candidate.pathname ||
      pathname.startsWith(`${candidate.pathname}/`),
  );

  return section?.id ?? "dashboard";
}

/** Собирает ссылку, отбрасывая пустые параметры. */
export function buildHref(
  pathname: string,
  params: Record<string, string | null | undefined> = {},
): string {
  const search = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value) {
      search.set(key, value);
    }
  });

  const query = search.toString();

  return query ? `${pathname}?${query}` : pathname;
}

/** Первое значение параметра поиска — Next отдаёт строку либо массив. */
export function firstParam(
  value: string | string[] | undefined,
): string | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}
