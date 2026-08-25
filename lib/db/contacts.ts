import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { fetchChannelParticipantAvatar } from "@/lib/channels/participant-avatar";
import {
  listChannelConnections,
  type ChannelConnectionRow,
} from "@/lib/db/channel-connections";
import { avatarProxyUrl } from "@/lib/avatars";
import {
  avatarFor,
  countWithNoun,
  platformLabel,
  type AvatarView,
  type ChannelFilterView,
  type ContactCardView,
  type ContactHistoryEntryView,
  type ContactListItemView,
  type Platform,
} from "@/lib/mock";
import { formatMessageTime } from "@/lib/mock/time";

/**
 * Typed data access behind the "Контакты" screen and the shell's contacts
 * navigation counters (docs/architecture/16-rollout-plan.md, этап 7;
 * docs/architecture/10-ui.md). Mirrors `lib/db/inbox.ts`/`lib/db/categories.ts`:
 * every function takes an already-constructed `SupabaseClient` and a
 * `workspaceId` rather than resolving them itself (directly testable against a
 * real local Supabase), and leaves RLS (`contacts_member_access` /
 * `contact_identities_member_access`,
 * supabase/migrations/20260720120000_…) as the source of truth — the explicit
 * `workspace_id` filters below are defense in depth, not a substitute.
 *
 * Returns the exact view models `lib/mock` exposes (`ContactListItemView`,
 * `ContactCardView`, `ChannelFilterView`) so only this data layer changes when
 * the section moves off mock — the models stay identical.
 *
 * Note on identities: the real `contact_identities` table carries `platform`
 * (not a `channel_connection_id`). A workspace has at most one channel per
 * platform (docs/architecture/05-channels.md), so the source channel name is
 * derived by matching the identity's platform to a `channel_connections` row;
 * when the platform has no connected channel we fall back to its label.
 *
 * `supabase` is untyped (no generated `Database` generic) — same as every
 * other Supabase client factory/consumer in this repo (no generated types yet).
 */

export type ContactResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export type MergeCandidate = {
  id: string;
  name: string;
};

export type ContactListFilter = {
  /** Каналы из мультиселекта в шапке списка; пусто — все. */
  channelIds?: readonly string[] | null;
  /** Смещение страницы — дозагрузка при скролле списка. */
  offset?: number;
  limit?: number;
};

/** Размер страницы списка контактов: первая порция и каждая дозагрузка. */
export const CONTACT_PAGE_SIZE = 40;

type ContactRow = {
  id: string;
  display_name: string;
  notes: string;
  tags: string[];
};

type ContactIdentityRow = {
  id: string;
  contact_id: string;
  platform: string;
  external_id: string;
  display_name: string | null;
  avatar_url: string | null;
  avatar_fetched_at: string | null;
};

const CONTACT_COLUMNS = "id, display_name, notes, tags";
const IDENTITY_COLUMNS =
  "id, contact_id, platform, external_id, display_name, avatar_url, avatar_fetched_at";

const CONTACT_AVATAR_PLATFORM_PRIORITY = [
  "instagram",
  "facebook",
  "telegram",
  "whatsapp",
] as const;

export function contactAvatarPlatformRank(platform: string): number {
  const rank = CONTACT_AVATAR_PLATFORM_PRIORITY.indexOf(
    platform as (typeof CONTACT_AVATAR_PLATFORM_PRIORITY)[number],
  );
  return rank === -1 ? CONTACT_AVATAR_PLATFORM_PRIORITY.length : rank;
}

function sortContactIdentities(
  identities: ContactIdentityRow[],
): ContactIdentityRow[] {
  return identities
    .map((identity, index) => ({ identity, index }))
    .sort(
      (left, right) =>
        contactAvatarPlatformRank(left.identity.platform) -
          contactAvatarPlatformRank(right.identity.platform) ||
        left.index - right.index,
    )
    .map(({ identity }) => identity);
}

function preferredAvatarIdentity(
  identities: ContactIdentityRow[],
): ContactIdentityRow | null {
  return (
    sortContactIdentities(identities).find((identity) => identity.avatar_url) ??
    null
  );
}

function contactAvatar(
  contact: ContactRow,
  identities: ContactIdentityRow[],
): AvatarView {
  const withPicture = preferredAvatarIdentity(identities);
  return avatarFor(
    contact.id,
    contact.display_name,
    withPicture
      ? avatarProxyUrl(
          withPicture.id,
          withPicture.avatar_url,
          withPicture.avatar_fetched_at,
        )
      : null,
  );
}

function truncate(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit).trimEnd()}…`;
}

/** Instagram handles read `@username`; other platforms show the stored name (or external id). */
function identityHandle(identity: ContactIdentityRow): string {
  if (identity.platform === "instagram") {
    return `@${identity.external_id}`;
  }

  return identity.display_name?.trim() || identity.external_id;
}

function channelNameForPlatform(
  channels: ChannelConnectionRow[],
  platform: string,
): string {
  const channel = channels.find((candidate) => candidate.platform === platform);

  return channel?.name ?? platformLabel(platform as Platform);
}

/**
 * Одна страница контактов, при необходимости суженная до платформ выбранных
 * каналов.
 *
 * Отбор по платформе идёт джойном (`contact_identities!inner`), а не фильтром
 * в JS после загрузки всех контактов: иначе страницу нельзя было бы отдавать
 * запросом — пришлось бы вычитать всю таблицу, чтобы отсчитать `offset`.
 */
async function loadContactsPage(
  supabase: SupabaseClient,
  workspaceId: string,
  platforms: readonly string[],
  offset: number,
  limit: number,
): Promise<{ rows: ContactRow[]; total: number }> {
  const narrowed = platforms.length > 0;

  let builder = supabase
    .from("contacts")
    .select(
      narrowed
        ? `${CONTACT_COLUMNS}, contact_identities!inner(platform)`
        : CONTACT_COLUMNS,
      { count: "exact" },
    )
    .eq("workspace_id", workspaceId);

  if (narrowed) {
    builder = builder.in("contact_identities.platform", [...platforms]);
  }

  const { data, error, count } = await builder
    .order("display_name", { ascending: true })
    .range(offset, offset + limit - 1);

  if (error) {
    console.error("[contacts] failed to list contacts", error);
    throw new Error("Unable to load contacts.");
  }

  // Двойное приведение: postgrest-js разбирает строку `select` в тип на этапе
  // компиляции, а она здесь ветвится — вывод даёт `ParserError`, не строку.
  const rows = (data ?? []) as unknown as ContactRow[];

  return { rows, total: count ?? rows.length };
}

/** Все контакты workspace — только для списка кандидатов на склейку. */
async function loadContacts(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<ContactRow[]> {
  const { data, error } = await supabase
    .from("contacts")
    .select(CONTACT_COLUMNS)
    .eq("workspace_id", workspaceId)
    .order("display_name", { ascending: true });

  if (error) {
    console.error("[contacts] failed to list contacts", error);
    throw new Error("Unable to load contacts.");
  }

  return (data ?? []) as ContactRow[];
}

async function loadContactById(
  supabase: SupabaseClient,
  workspaceId: string,
  contactId: string,
): Promise<ContactRow | null> {
  const { data, error } = await supabase
    .from("contacts")
    .select(CONTACT_COLUMNS)
    .eq("workspace_id", workspaceId)
    .eq("id", contactId)
    .maybeSingle();

  if (error) {
    console.error("[contacts] failed to load contact", error);
    throw new Error("Unable to load the contact.");
  }

  return (data as ContactRow | null) ?? null;
}

/** Every identity in the workspace, or only those of the given contacts. */
async function loadIdentities(
  supabase: SupabaseClient,
  workspaceId: string,
  contactIds?: string[],
): Promise<ContactIdentityRow[]> {
  if (contactIds && contactIds.length === 0) {
    return [];
  }

  let query = supabase
    .from("contact_identities")
    .select(IDENTITY_COLUMNS)
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: true });

  if (contactIds) {
    query = query.in("contact_id", contactIds);
  }

  const { data, error } = await query;

  if (error) {
    console.error("[contacts] failed to load contact identities", error);
    throw new Error("Unable to load contact identities.");
  }

  return (data ?? []) as ContactIdentityRow[];
}

function groupIdentitiesByContact(
  identities: ContactIdentityRow[],
): Map<string, ContactIdentityRow[]> {
  const map = new Map<string, ContactIdentityRow[]>();

  for (const identity of identities) {
    const bucket = map.get(identity.contact_id);
    if (bucket) {
      bucket.push(identity);
    } else {
      map.set(identity.contact_id, [identity]);
    }
  }

  return map;
}

/** Distinct contacts per platform — the base for both the nav counters and the filter chips. */
async function contactCountsByPlatform(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<Map<string, number>> {
  const identities = await loadIdentities(supabase, workspaceId);
  const contactsByPlatform = new Map<string, Set<string>>();

  for (const identity of identities) {
    const bucket = contactsByPlatform.get(identity.platform);
    if (bucket) {
      bucket.add(identity.contact_id);
    } else {
      contactsByPlatform.set(identity.platform, new Set([identity.contact_id]));
    }
  }

  const counts = new Map<string, number>();
  for (const [platform, contacts] of contactsByPlatform) {
    counts.set(platform, contacts.size);
  }

  return counts;
}

function contactListItem(
  contact: ContactRow,
  identities: ContactIdentityRow[],
): ContactListItemView {
  const orderedIdentities = sortContactIdentities(identities);

  return {
    id: contact.id,
    name: contact.display_name,
    avatar: contactAvatar(contact, orderedIdentities),
    handles: orderedIdentities.map(identityHandle).join(" · "),
    platforms: orderedIdentities.map(
      (identity) => identity.platform as Platform,
    ),
    tag: contact.tags[0] ?? null,
  };
}

/** Filter chips (`FilterChips`) on the contacts screen — `ChannelFilterView` shape. */
export async function getContactChannelFilters(
  supabase: SupabaseClient,
  workspaceId: string,
  channels: ChannelConnectionRow[],
): Promise<ChannelFilterView[]> {
  const counts = await contactCountsByPlatform(supabase, workspaceId);

  return channels.map((channel) => ({
    id: channel.id,
    name: channel.name,
    platform: channel.platform,
    count: counts.get(channel.platform) ?? 0,
  }));
}

export type ContactListView = {
  title: string;
  subtitle: string;
  items: ContactListItemView[];
};

export type ContactListPage = ContactListView & {
  /** Сколько всего контактов под фильтром — подпись «N контактов» точная. */
  total: number;
  hasMore: boolean;
};

/**
 * Contact list, optionally narrowed to contacts present on the picked channels'
 * platforms, one page at a time.
 *
 * Контакт хранит identities с `platform`, а не с `channel_connection_id`
 * (у платформы в workspace не больше одного канала — см. докстринг модуля),
 * поэтому выбранные каналы разворачиваются в набор платформ.
 */
export async function getContactListView(
  supabase: SupabaseClient,
  workspaceId: string,
  channels: ChannelConnectionRow[],
  filter: ContactListFilter = {},
): Promise<ContactListPage> {
  const channelIds = filter.channelIds ?? [];
  const selectedChannels = channels.filter((channel) =>
    channelIds.includes(channel.id),
  );
  const platforms = [
    ...new Set(selectedChannels.map((channel) => channel.platform)),
  ];
  const offset = Math.max(0, filter.offset ?? 0);
  const limit = Math.max(1, filter.limit ?? CONTACT_PAGE_SIZE);

  const { rows: contacts, total } = await loadContactsPage(
    supabase,
    workspaceId,
    platforms,
    offset,
    limit,
  );
  // Джойн выше вернул только identities выбранных платформ — для строки списка
  // (хендлы, точки платформ) нужны все identities этих контактов.
  const identities = await loadIdentities(
    supabase,
    workspaceId,
    contacts.map((contact) => contact.id),
  );
  const identitiesByContact = groupIdentitiesByContact(identities);

  const items = contacts.map((contact) =>
    contactListItem(contact, identitiesByContact.get(contact.id) ?? []),
  );

  return {
    title: selectedChannels.length === 1 ? selectedChannels[0].name : "Контакты",
    subtitle: [
      selectedChannels.length === 1 ? "контакты канала" : "все каналы",
      countWithNoun(total, ["контакт", "контакта", "контактов"]),
    ].join(" · "),
    items,
    total,
    hasMore: offset + items.length < total,
  };
}

/** Full contact card: identities per channel + cross-channel history (DM threads and comment posts). */
export async function getContactCardView(
  supabase: SupabaseClient,
  workspaceId: string,
  channels: ChannelConnectionRow[],
  contactId: string,
): Promise<ContactCardView | null> {
  const contact = await loadContactById(supabase, workspaceId, contactId);

  if (!contact) {
    return null;
  }

  const identities = sortContactIdentities(
    await loadIdentities(supabase, workspaceId, [contactId]),
  );
  const identityIds = identities.map((identity) => identity.id);
  const nowIso = new Date().toISOString();

  // DM threads are linked to the contact directly; posts are linked only
  // through the identities that authored comments under them.
  const { data: dmRows, error: dmError } = await supabase
    .from("conversations")
    .select("id, channel_connection_id, last_incoming_at")
    .eq("workspace_id", workspaceId)
    .eq("contact_id", contactId);

  if (dmError) {
    console.error("[contacts] failed to load DM history", dmError);
    throw new Error("Unable to load the contact history.");
  }

  let postRows: Array<{
    id: string;
    text: string;
    last_comment_at: string | null;
  }> = [];

  if (identityIds.length > 0) {
    const { data: authoredRows, error: authoredError } = await supabase
      .from("comments")
      .select("post_id")
      .eq("workspace_id", workspaceId)
      .in("contact_identity_id", identityIds);

    if (authoredError) {
      console.error("[contacts] failed to load authored comments", authoredError);
      throw new Error("Unable to load the contact history.");
    }

    const postIds = [
      ...new Set(
        ((authoredRows ?? []) as Array<{ post_id: string }>).map(
          (row) => row.post_id,
        ),
      ),
    ];

    if (postIds.length > 0) {
      const { data, error } = await supabase
        .from("posts")
        .select("id, text, last_comment_at")
        .eq("workspace_id", workspaceId)
        .in("id", postIds);

      if (error) {
        console.error("[contacts] failed to load comment history", error);
        throw new Error("Unable to load the contact history.");
      }

      postRows = (data ?? []) as typeof postRows;
    }
  }

  const history: ContactHistoryEntryView[] = [
    ...((dmRows ?? []) as Array<{
      id: string;
      channel_connection_id: string;
      last_incoming_at: string | null;
    }>).map((conversation) => {
      const channel = channels.find(
        (candidate) => candidate.id === conversation.channel_connection_id,
      );

      return {
        conversationId: conversation.id,
        kind: "dm" as const,
        label: `Переписка · ${channel?.name ?? "—"}`,
        lastIncomingAt: conversation.last_incoming_at,
      };
    }),
    ...postRows.map((post) => ({
      conversationId: post.id,
      kind: "comments" as const,
      label: `Комментарий к посту «${truncate(post.text, 28)}»`,
      lastIncomingAt: post.last_comment_at,
    })),
  ]
    .sort((left, right) =>
      (right.lastIncomingAt ?? "").localeCompare(left.lastIncomingAt ?? ""),
    )
    .map(({ conversationId, kind, label, lastIncomingAt }) => ({
      conversationId,
      kind,
      label,
      time: lastIncomingAt ? formatMessageTime(lastIncomingAt, nowIso) : "",
    }));

  return {
    id: contact.id,
    name: contact.display_name,
    avatar: contactAvatar(contact, identities),
    tags: contact.tags,
    notes: contact.notes,
    identities: identities.map((identity) => ({
      id: identity.id,
      platform: identity.platform as Platform,
      platformLabel: platformLabel(identity.platform as Platform),
      handle: identityHandle(identity),
      channelName: channelNameForPlatform(channels, identity.platform),
    })),
    history,
  };
}

export type RefreshedContactAvatar = {
  imageUrl: string | null;
};

/**
 * Explicit user-requested refresh. Identities are tried in product priority
 * order: Instagram → Facebook → Telegram → WhatsApp → future platforms.
 * A provider-confirmed missing picture clears that identity and falls through
 * to the next channel; a participant the provider could not find is preserved.
 */
export async function refreshContactAvatar(
  supabase: SupabaseClient,
  workspaceId: string,
  channels: ChannelConnectionRow[],
  contactId: string,
): Promise<ContactResult<RefreshedContactAvatar>> {
  const contact = await loadContactById(supabase, workspaceId, contactId);
  if (!contact) {
    return { ok: false, error: "Контакт не найден." };
  }

  const identities = sortContactIdentities(
    await loadIdentities(supabase, workspaceId, [contactId]),
  );
  let supportedChannelSeen = false;
  let confirmedParticipantSeen = false;

  for (const identity of identities) {
    const channel = channels.find(
      (candidate) =>
        candidate.platform === identity.platform && candidate.status === "active",
    );
    if (!channel) continue;

    const { data: conversation, error: conversationError } = await supabase
      .from("conversations")
      .select("external_id")
      .eq("workspace_id", workspaceId)
      .eq("contact_id", contactId)
      .eq("channel_connection_id", channel.id)
      .order("last_incoming_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (conversationError) {
      console.error(
        "[contacts] failed to resolve a conversation for avatar refresh",
        conversationError,
      );
      return { ok: false, error: "Не удалось обновить аватар." };
    }

    const lookup = await fetchChannelParticipantAvatar({
      provider: channel.provider,
      externalAccountId: channel.external_id,
      participantExternalId: identity.external_id,
      conversationExternalId: conversation?.external_id,
    });
    if (!lookup.supported) continue;
    supportedChannelSeen = true;

    if (!lookup.found) {
      // A stale higher-priority picture must not silently be replaced by a
      // lower-priority channel merely because a bounded provider search did
      // not find its participant.
      if (identity.avatar_url) {
        return {
          ok: false,
          error: `Не удалось найти контакт в канале ${channel.name}.`,
        };
      }
      continue;
    }

    confirmedParticipantSeen = true;
    const fetchedAt = new Date().toISOString();
    const { data: updated, error: updateError } = await supabase
      .from("contact_identities")
      .update({
        avatar_url: lookup.avatarUrl,
        avatar_fetched_at: fetchedAt,
        updated_at: fetchedAt,
      })
      .eq("workspace_id", workspaceId)
      .eq("id", identity.id)
      .select("id")
      .maybeSingle();
    if (updateError || !updated) {
      console.error(
        "[contacts] failed to save a manually refreshed avatar",
        updateError,
      );
      return { ok: false, error: "Не удалось сохранить новый аватар." };
    }

    identity.avatar_url = lookup.avatarUrl;
    identity.avatar_fetched_at = fetchedAt;
    if (lookup.avatarUrl) break;
  }

  if (!supportedChannelSeen) {
    return {
      ok: false,
      error: "У контакта нет активного канала с поддержкой аватаров.",
    };
  }
  if (!confirmedParticipantSeen) {
    return {
      ok: false,
      error: "Провайдер не нашёл этот контакт для обновления аватара.",
    };
  }

  const preferred = preferredAvatarIdentity(identities);
  return {
    ok: true,
    data: {
      imageUrl: preferred
        ? avatarProxyUrl(
            preferred.id,
            preferred.avatar_url,
            preferred.avatar_fetched_at,
          )
        : null,
    },
  };
}

/** Other contacts in the workspace — the target list for a manual merge. */
export async function listMergeCandidates(
  supabase: SupabaseClient,
  workspaceId: string,
  contactId: string,
): Promise<MergeCandidate[]> {
  const contacts = await loadContacts(supabase, workspaceId);

  return contacts
    .filter((contact) => contact.id !== contactId)
    .map((contact) => ({ id: contact.id, name: contact.display_name }));
}

/** Contact notes flow into the draft prompt (docs/architecture/16-rollout-plan.md, этап 7). */
export async function updateContactNotes(
  supabase: SupabaseClient,
  workspaceId: string,
  contactId: string,
  notes: string,
): Promise<ContactResult<null>> {
  const { data, error } = await supabase
    .from("contacts")
    .update({ notes: notes.trim() })
    .eq("workspace_id", workspaceId)
    .eq("id", contactId)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[contacts] failed to update notes", error);
    if (error.code === "42501") {
      return { ok: false, error: "Нет доступа к этому рабочему пространству." };
    }
    return { ok: false, error: "Не удалось сохранить заметку." };
  }
  if (!data) {
    return { ok: false, error: "Контакт не найден." };
  }

  return { ok: true, data: null };
}

/**
 * Manual merge (docs/architecture/06-data-model.md#contact_identities): move the
 * source contact's identities and conversations onto the kept contact, merge
 * notes and tags, then delete the source — all in one transaction via the
 * `merge_contacts` RPC.
 */
export async function mergeContacts(
  supabase: SupabaseClient,
  workspaceId: string,
  input: { sourceId: string; targetId: string },
): Promise<ContactResult<null>> {
  if (input.sourceId === input.targetId) {
    return { ok: false, error: "Выберите другой контакт для склейки." };
  }

  const { data, error } = await supabase.rpc("merge_contacts", {
    target_workspace_id: workspaceId,
    source_contact_id: input.sourceId,
    keep_contact_id: input.targetId,
  });

  if (error) {
    console.error("[contacts] failed to merge contacts", error);
    if (error.code === "42501") {
      return { ok: false, error: "Нет доступа к этому рабочему пространству." };
    }
    if (error.code === "22023") {
      return { ok: false, error: "Контакты для склейки указаны неверно." };
    }
    return { ok: false, error: "Не удалось склеить контакты." };
  }
  if (data !== true) {
    return { ok: false, error: "Контакт не найден." };
  }

  return { ok: true, data: null };
}

/** Re-exported so the page needs a single import for both the channel list and this module. */
export { listChannelConnections, type ChannelConnectionRow };
