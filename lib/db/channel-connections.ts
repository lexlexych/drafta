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
 * Platforms the "add channel" form offers — the same set
 * `lib/channels/capabilities.ts` has defaults for (T-01). Only Zernio is a
 * registered provider (T-02), so every connection created here is
 * `provider = "zernio"`; nothing here imports Zernio-specific code, though
 * (vibecoding rule 4) — just the provider-agnostic platform/capabilities
 * types from `lib/channels/`.
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

export type CreateChannelConnectionInput = {
  platform: string;
  externalId: string;
  name: string;
};

/**
 * Creates a `channel_connections` row: provider fixed to `"zernio"` (the
 * only registered provider), capabilities filled with the platform's
 * defaults (T-01's `getDefaultChannelCapabilities`) — see the ticket's step
 * 1/acceptance criteria. Friendly error on a duplicate
 * (workspace, provider, external_id) — the table's unique constraint
 * (supabase/migrations/20260720103000_create_schema_v1.sql).
 */
export async function createChannelConnection(
  supabase: SupabaseClient,
  workspaceId: string,
  input: CreateChannelConnectionInput,
): Promise<ChannelConnectionResult<ChannelConnectionRow>> {
  const name = input.name.trim();
  const externalId = input.externalId.trim();
  const platform = input.platform as ChannelPlatform;

  if (!name) {
    return { ok: false, error: "Введите имя подключения." };
  }
  if (!externalId) {
    return { ok: false, error: "Введите внешний ID аккаунта." };
  }
  if (!SUPPORTED_CHANNEL_PLATFORMS.includes(platform)) {
    return { ok: false, error: "Выберите поддерживаемую платформу." };
  }

  const { data, error } = await supabase
    .from("channel_connections")
    .insert({
      workspace_id: workspaceId,
      name,
      provider: "zernio",
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
        error:
          "Такой канал уже подключён: этот внешний ID уже используется в этом workspace.",
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

function isUniqueViolation(error: { code?: string }): boolean {
  // Postgres SQLSTATE for unique_violation — stable across Postgres
  // versions, unlike PostgREST's prose error message (see the same helper
  // in lib/webhooks/process-event.ts).
  return error.code === "23505";
}
