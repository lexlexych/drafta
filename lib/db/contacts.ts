import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  listChannelConnections,
  type ChannelConnectionRow,
} from "@/lib/db/channel-connections";
import {
  avatarFor,
  countWithNoun,
  platformLabel,
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
  channelId?: string | null;
};

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
};

const CONTACT_COLUMNS = "id, display_name, notes, tags";
const IDENTITY_COLUMNS = "id, contact_id, platform, external_id, display_name";

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

function postText(postMetadata: unknown): string {
  if (typeof postMetadata !== "object" || postMetadata === null) {
    return "";
  }

  const value = (postMetadata as Record<string, unknown>).text;

  return typeof value === "string" ? value : "";
}

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
    .eq("workspace_id", workspaceId);

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
  return {
    id: contact.id,
    name: contact.display_name,
    avatar: avatarFor(contact.id, contact.display_name),
    handles: identities.map(identityHandle).join(" · "),
    platforms: identities.map((identity) => identity.platform as Platform),
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

/** Contact list, optionally narrowed to contacts present on one channel's platform. */
export async function getContactListView(
  supabase: SupabaseClient,
  workspaceId: string,
  channels: ChannelConnectionRow[],
  filter: ContactListFilter = {},
): Promise<ContactListView> {
  const channelId = filter.channelId ?? null;
  const selectedChannel = channelId
    ? (channels.find((channel) => channel.id === channelId) ?? null)
    : null;

  const [contacts, identities] = await Promise.all([
    loadContacts(supabase, workspaceId),
    loadIdentities(supabase, workspaceId),
  ]);
  const identitiesByContact = groupIdentitiesByContact(identities);

  const items = contacts
    .map((contact) => ({
      contact,
      identities: identitiesByContact.get(contact.id) ?? [],
    }))
    .filter(({ identities: contactIdentities }) =>
      contactIdentities.some(
        (identity) =>
          !selectedChannel || identity.platform === selectedChannel.platform,
      ),
    )
    .map(({ contact, identities: contactIdentities }) =>
      contactListItem(contact, contactIdentities),
    );

  return {
    title: selectedChannel?.name ?? "Контакты",
    subtitle: [
      selectedChannel ? "контакты канала" : "все каналы",
      countWithNoun(items.length, ["контакт", "контакта", "контактов"]),
    ].join(" · "),
    items,
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

  const identities = await loadIdentities(supabase, workspaceId, [contactId]);
  const identityIds = identities.map((identity) => identity.id);
  const nowIso = new Date().toISOString();

  // DM threads are linked to the contact directly; comment posts are linked
  // only through the identities that authored comments in them (the same
  // cross-channel reduction the mock layer uses, lib/mock/index.ts).
  const { data: dmRows, error: dmError } = await supabase
    .from("conversations")
    .select("id, channel_connection_id, last_incoming_at")
    .eq("workspace_id", workspaceId)
    .eq("kind", "dm")
    .eq("contact_id", contactId);

  if (dmError) {
    console.error("[contacts] failed to load DM history", dmError);
    throw new Error("Unable to load the contact history.");
  }

  let commentRows: Array<{
    id: string;
    channel_connection_id: string;
    last_incoming_at: string | null;
    post_metadata: unknown;
  }> = [];

  if (identityIds.length > 0) {
    const { data: authoredRows, error: authoredError } = await supabase
      .from("messages")
      .select("conversation_id")
      .eq("workspace_id", workspaceId)
      .in("contact_identity_id", identityIds);

    if (authoredError) {
      console.error("[contacts] failed to load authored comments", authoredError);
      throw new Error("Unable to load the contact history.");
    }

    const commentConversationIds = [
      ...new Set(
        ((authoredRows ?? []) as Array<{ conversation_id: string }>).map(
          (row) => row.conversation_id,
        ),
      ),
    ];

    if (commentConversationIds.length > 0) {
      const { data, error } = await supabase
        .from("conversations")
        .select("id, channel_connection_id, last_incoming_at, post_metadata")
        .eq("workspace_id", workspaceId)
        .eq("kind", "comments")
        .in("id", commentConversationIds);

      if (error) {
        console.error("[contacts] failed to load comment history", error);
        throw new Error("Unable to load the contact history.");
      }

      commentRows = (data ?? []) as typeof commentRows;
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
    ...commentRows.map((conversation) => ({
      conversationId: conversation.id,
      kind: "comments" as const,
      label: `Комментарий к посту «${truncate(postText(conversation.post_metadata), 28)}»`,
      lastIncomingAt: conversation.last_incoming_at,
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
    avatar: avatarFor(contact.id, contact.display_name),
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
