/** Маршруты защищённой зоны и сборка ссылок с фильтрами. */

/**
 * Unread total for the "Сообщения"/"Комментарии" nav items (T-05,
 * docs/epics/epic_02/T-05-inbox-messages.md) — `lib/db/inbox.ts` (server-only)
 * returns a superset of this shape, `Sidebar`/`Tabbar` (client components)
 * declare it here instead of importing the server module's type directly, same
 * convention `channels-panel.tsx` uses for `lib/db/channel-connections.ts`
 * (T-04): a small parallel client-side type, not a cross-boundary import of a
 * `"server-only"`-marked module.
 */
export type InboxNavCounters = {
  totalUnread: number;
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
  /**
   * Пункт не ведёт на страницу, а раскрывается в подсписок разделов настроек.
   * «Сообщения», «Комментарии» и «Контакты» расхлопа не имеют: экраны
   * показывают записи всех каналов без фильтра по каналу в меню.
   */
  expandable: boolean;
};

export const SECTIONS: SectionDescriptor[] = [
  { id: "dashboard", label: "Дашборд", pathname: "/dashboard", expandable: false },
  { id: "inbox", label: "Сообщения", pathname: "/inbox", expandable: false },
  { id: "comments", label: "Комментарии", pathname: "/comments", expandable: false },
  { id: "contacts", label: "Контакты", pathname: "/contacts", expandable: false },
  { id: "settings", label: "Настройки", pathname: "/settings", expandable: true },
];

export const QUERY_KEYS = {
  channel: "channel",
  category: "category",
  conversation: "conversation",
  /** Open post on «Комментарии» — posts are not conversations. */
  post: "post",
  contact: "contact",
  section: "section",
  /** Окно дашборда: `day` | `week` | `month` (`lib/db/dashboard.ts`). */
  period: "period",
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

/**
 * Мультизначный параметр (сейчас — `category`) хранится в адресе списком через
 * запятую: так фильтр целиком живёт в URL и переживает открытие диалога.
 */
export function parseIdList(value: string | null): string[] {
  if (!value) {
    return [];
  }

  return [...new Set(value.split(",").map((id) => id.trim()).filter(Boolean))];
}

export function serializeIdList(ids: readonly string[]): string | null {
  return ids.length > 0 ? ids.join(",") : null;
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
