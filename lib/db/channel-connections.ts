import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { DEFAULT_CHANNEL_CAPABILITIES } from "@/lib/channels/capabilities";
import type { ChannelPlatform } from "@/lib/channels/types";

/**
 * Typed data access for `channel_connections` — Settings → Channels
 * (docs/epics/epic_02/T-04-channels-settings.md).
 *
 * Every function takes an already-constructed `SupabaseClient` rather than
 * creating one itself, mirroring `lib/webhooks/process-event.ts`: it keeps
 * this module a pure function of its inputs (directly unit-testable against
 * a real local Supabase, no `next/headers` request context required) and
 * leaves the choice of client — the cookie-scoped, RLS-respecting client for
 * the app's server actions (`lib/db/server.ts`), an admin client only in
 * tests — to the caller. `channel_connections` RLS ("for all" to any
 * workspace member — supabase/migrations/20260720120000_…) already enforces
 * per-workspace isolation; the explicit `workspace_id` filters below are
 * defense in depth, not a substitute for it.
 *
 * `supabase` is untyped (no generated `Database` generic) — same as every
 * other Supabase client factory/consumer in this repo (no generated types
 * yet).
 */

export type ChannelConnectionStatus = "active" | "disconnected" | "error";

/** The subset of statuses a workspace member can set through this UI — "error" is set by future automated processes only (docs/epics/epic_02/T-04-channels-settings.md: "отключение = смена статуса… не удаление"). */
export type SettableChannelConnectionStatus = Extract<
  ChannelConnectionStatus,
  "active" | "disconnected"
>;

export type ChannelConnectionRow = {
  id: string;
  workspace_id: string;
  name: string;
  provider: string;
  platform: ChannelPlatform;
  external_id: string;
  status: ChannelConnectionStatus;
  capabilities: Record<string, unknown>;
  created_at: string;
};

export type ChannelConnectionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

/**
 * Platforms the "add channel" flow offers — the same set
 * `lib/channels/capabilities.ts` has defaults for (T-01). Nothing here
 * imports Zernio-specific code (vibecoding rule 4) — just the
 * provider-agnostic platform/capabilities types from `lib/channels/`. The
 * `provider` is passed in by the account-connect callback (resolved from the
 * `[provider]` route segment), not hardcoded here.
 */
export const SUPPORTED_CHANNEL_PLATFORMS = Object.keys(
  DEFAULT_CHANNEL_CAPABILITIES,
) as ChannelPlatform[];

const CHANNEL_CONNECTION_COLUMNS =
  "id, workspace_id, name, provider, platform, external_id, status, capabilities, created_at";

export async function listChannelConnections(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<ChannelConnectionRow[]> {
  const { data, error } = await supabase
    .from("channel_connections")
    .select(CHANNEL_CONNECTION_COLUMNS)
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[settings/channels] failed to list channel_connections", error);
    throw new Error("Unable to load channel connections.");
  }

  return (data ?? []) as ChannelConnectionRow[];
}

/**
 * One connection of the workspace, or `null` when it doesn't exist (or RLS
 * hides it). The deletion flow needs the row's `provider`/`external_id` to ask
 * the provider to disconnect the account before the row is gone.
 */
export async function getChannelConnection(
  supabase: SupabaseClient,
  workspaceId: string,
  id: string,
): Promise<ChannelConnectionRow | null> {
  const { data, error } = await supabase
    .from("channel_connections")
    .select(CHANNEL_CONNECTION_COLUMNS)
    .eq("workspace_id", workspaceId)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("[settings/channels] failed to load channel_connection", error);
    throw new Error("Unable to load the channel connection.");
  }

  return (data as ChannelConnectionRow | null) ?? null;
}

/**
 * The workspace's connection for one provider account, or `null`. Used by the
 * connect callback to tell "this very account is already connected" (a repeat
 * of the same callback — nothing to do) from "another account of this platform
 * is connected" (a real conflict).
 */
export async function findChannelConnectionByExternalId(
  supabase: SupabaseClient,
  workspaceId: string,
  provider: string,
  externalId: string,
): Promise<ChannelConnectionRow | null> {
  const { data, error } = await supabase
    .from("channel_connections")
    .select(CHANNEL_CONNECTION_COLUMNS)
    .eq("workspace_id", workspaceId)
    .eq("provider", provider)
    .eq("external_id", externalId)
    .maybeSingle();

  if (error) {
    console.error(
      "[settings/channels] failed to look up a channel_connection by external id",
      error,
    );
    return null;
  }

  return (data as ChannelConnectionRow | null) ?? null;
}

/** True when this workspace already owns a connection for the platform. */
export async function hasChannelConnectionForPlatform(
  supabase: SupabaseClient,
  workspaceId: string,
  platform: ChannelPlatform,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("channel_connections")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("platform", platform)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error(
      "[settings/channels] failed to check the workspace platform connection",
      error,
    );
    throw new Error("Unable to check channel connection availability.");
  }

  return data !== null;
}

export type CreateChannelConnectionInput = {
  /** Resolved from the account-connect callback's `[provider]` route segment. */
  provider: string;
  platform: string;
  /**
   * External account ID obtained from the provider's OAuth callback — not
   * user-typed. Must match what the provider reports on inbound webhooks
   * (lib/webhooks/process-event.ts resolves the row by (provider, external_id)).
   */
  externalId: string;
  name: string;
};

/**
 * Creates a `channel_connections` row for a just-authorized account:
 * `provider`/`externalId` come from the OAuth connect callback
 * (`app/api/channels/[provider]/connect/callback/`), capabilities are filled
 * with the platform's defaults (T-01's `getDefaultChannelCapabilities`).
 * Friendly error on a duplicate platform or external account — enforced by
 * the table's unique constraints.
 */
export async function createChannelConnection(
  supabase: SupabaseClient,
  workspaceId: string,
  input: CreateChannelConnectionInput,
): Promise<ChannelConnectionResult<ChannelConnectionRow>> {
  const name = input.name.trim();
  const provider = input.provider.trim();
  const externalId = input.externalId.trim();
  const platform = input.platform as ChannelPlatform;

  if (!name) {
    return { ok: false, error: "Введите имя подключения." };
  }
  // externalId comes from the provider, not the user — an empty one is a
  // provider/flow error, not a form validation message.
  if (!externalId) {
    return { ok: false, error: "Провайдер не вернул идентификатор аккаунта." };
  }
  if (!provider) {
    return { ok: false, error: "Не удалось определить провайдера подключения." };
  }
  if (!SUPPORTED_CHANNEL_PLATFORMS.includes(platform)) {
    return { ok: false, error: "Выберите поддерживаемую платформу." };
  }

  const { data, error } = await supabase
    .from("channel_connections")
    .insert({
      workspace_id: workspaceId,
      name,
      provider,
      platform,
      external_id: externalId,
      capabilities: DEFAULT_CHANNEL_CAPABILITIES[platform],
    })
    .select(CHANNEL_CONNECTION_COLUMNS)
    .single();

  if (error) {
    if (isUniqueViolation(error)) {
      return {
        ok: false,
        error: "Канал этой платформы уже подключён к рабочему пространству.",
      };
    }

    console.error("[settings/channels] failed to create channel_connection", error);
    return { ok: false, error: "Не удалось создать подключение." };
  }

  return { ok: true, data: data as ChannelConnectionRow };
}

export async function renameChannelConnection(
  supabase: SupabaseClient,
  workspaceId: string,
  id: string,
  name: string,
): Promise<ChannelConnectionResult<ChannelConnectionRow>> {
  const trimmed = name.trim();

  if (!trimmed) {
    return { ok: false, error: "Введите имя подключения." };
  }

  const { data, error } = await supabase
    .from("channel_connections")
    .update({ name: trimmed })
    .eq("workspace_id", workspaceId)
    .eq("id", id)
    .select(CHANNEL_CONNECTION_COLUMNS)
    .maybeSingle();

  if (error) {
    console.error("[settings/channels] failed to rename channel_connection", error);
    return { ok: false, error: "Не удалось переименовать подключение." };
  }
  if (!data) {
    return { ok: false, error: "Подключение не найдено." };
  }

  return { ok: true, data: data as ChannelConnectionRow };
}

export async function setChannelConnectionStatus(
  supabase: SupabaseClient,
  workspaceId: string,
  id: string,
  status: SettableChannelConnectionStatus,
): Promise<ChannelConnectionResult<ChannelConnectionRow>> {
  const { data, error } = await supabase
    .from("channel_connections")
    .update({ status })
    .eq("workspace_id", workspaceId)
    .eq("id", id)
    .select(CHANNEL_CONNECTION_COLUMNS)
    .maybeSingle();

  if (error) {
    console.error(
      "[settings/channels] failed to update channel_connection status",
      error,
    );
    return { ok: false, error: "Не удалось изменить статус подключения." };
  }
  if (!data) {
    return { ok: false, error: "Подключение не найдено." };
  }

  return { ok: true, data: data as ChannelConnectionRow };
}

/**
 * Deletes the connection row. Everything that hangs off it goes with it: the
 * `conversations` and `posts` of this channel cascade
 * (`on delete cascade` on the `(workspace_id, channel_connection_id)` FKs),
 * and their messages/comments/drafts cascade in turn — the channel's
 * correspondence disappears from drafta while staying untouched on the
 * platform itself. References from `categories.channel_connection_ids` (an
 * array, not an FK) are stripped by the
 * `channel_connections_strip_from_categories` trigger
 * (supabase/migrations/20260727110000_…).
 *
 * Deleting is not the same as disconnecting: «Отключить» only flips `status`
 * and keeps the history (see `setChannelConnectionStatus`).
 */
export async function deleteChannelConnection(
  supabase: SupabaseClient,
  workspaceId: string,
  id: string,
): Promise<ChannelConnectionResult<{ id: string }>> {
  const { data, error } = await supabase
    .from("channel_connections")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("id", id)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[settings/channels] failed to delete channel_connection", error);
    return { ok: false, error: "Не удалось удалить канал." };
  }
  if (!data) {
    return { ok: false, error: "Подключение не найдено." };
  }

  return { ok: true, data: data as { id: string } };
}

function isUniqueViolation(error: { code?: string }): boolean {
  // Postgres SQLSTATE for unique_violation — stable across Postgres
  // versions, unlike PostgREST's prose error message (see the same helper
  // in lib/webhooks/process-event.ts).
  return error.code === "23505";
}
