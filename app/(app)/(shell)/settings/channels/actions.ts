"use server";

import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";

// Side-effect import: registers the Zernio adapter under the "zernio"
// provider name (lib/channels/registry.ts) so `resolveChannelAdapter` below
// can find its `getConnectUrl` — same registration the webhook route relies
// on (app/api/webhooks/[provider]/route.ts).
import "@/lib/channels/zernio";
import {
  resolveChannelAdapter,
  UnknownChannelProviderError,
} from "@/lib/channels/registry";
import {
  CONNECT_STATE_NONCE_COOKIE,
  CONNECT_STATE_TTL_SECONDS,
  createConnectNonce,
  signConnectState,
} from "@/lib/channels/connect-state";
import type { ChannelPlatform } from "@/lib/channels/types";
import {
  renameChannelConnection,
  setChannelConnectionStatus,
  SUPPORTED_CHANNEL_PLATFORMS,
  type ChannelConnectionResult,
  type ChannelConnectionRow,
  type SettableChannelConnectionStatus,
} from "@/lib/db/channel-connections";
import { createServerSupabaseClient } from "@/lib/db/server";
import { getAuthenticatedUser, getCurrentWorkspace } from "@/lib/db/workspace";

/**
 * Server actions behind Settings → Channels
 * (docs/epics/epic_02/T-04-channels-settings.md). Thin wrappers: resolve the
 * *authenticated caller's own* workspace from the session (never a
 * client-supplied workspace id — a client could ask for anyone's), get the
 * cookie-scoped, RLS-respecting Supabase client (`lib/db/server.ts`, per the
 * ticket's "пользовательские запросы идут через publishable-клиент под
 * RLS"), and delegate the actual work to `lib/db/channel-connections.ts` —
 * which stays a plain, directly testable function of its inputs.
 *
 * Connecting a channel is a two-step OAuth flow: `startChannelConnectionAction`
 * hands back the provider's authorization URL (the row is created later, by
 * the callback route `app/api/channels/[provider]/connect/callback/`, once the
 * account is authorized). The user never sees or touches the provider's own
 * dashboard.
 */

const SETTINGS_PATH = "/settings";

/**
 * Provider that brokers the account-connect (OAuth) flow. Zernio is the only
 * registered provider today and fronts every platform; when a second provider
 * lands, this becomes a platform→provider lookup.
 */
const CONNECT_PROVIDER = "zernio";

export type StartChannelConnectionResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

async function requireCurrentWorkspaceId(): Promise<
  { ok: true; workspaceId: string } | { ok: false; error: string }
> {
  const user = await getAuthenticatedUser();

  if (!user) {
    return { ok: false, error: "Сессия истекла — войдите заново." };
  }

  const workspace = await getCurrentWorkspace(user.id);

  if (!workspace) {
    return { ok: false, error: "Рабочее пространство не найдено." };
  }

  return { ok: true, workspaceId: workspace.id };
}

/**
 * Starts connecting a channel: validates the choice, mints a signed `state`
 * (+ an httpOnly nonce cookie for CSRF), and returns the provider's
 * authorization URL for the client to redirect to. No row is written yet —
 * the callback route creates it once the account is authorized.
 */
export async function startChannelConnectionAction(input: {
  platform: string;
  name: string;
}): Promise<StartChannelConnectionResult> {
  const workspace = await requireCurrentWorkspaceId();

  if (!workspace.ok) {
    return workspace;
  }

  const name = input.name.trim();
  const platform = input.platform as ChannelPlatform;

  if (!name) {
    return { ok: false, error: "Введите имя подключения." };
  }
  if (!SUPPORTED_CHANNEL_PLATFORMS.includes(platform)) {
    return { ok: false, error: "Выберите поддерживаемую платформу." };
  }

  let adapter;
  try {
    adapter = resolveChannelAdapter(CONNECT_PROVIDER);
  } catch (error) {
    if (error instanceof UnknownChannelProviderError) {
      return { ok: false, error: "Подключение канала пока недоступно." };
    }
    throw error;
  }

  if (!adapter.getConnectUrl) {
    return { ok: false, error: "Этот канал пока нельзя подключить через OAuth." };
  }

  const origin = await resolveRequestOrigin();
  if (!origin) {
    return { ok: false, error: "Не удалось определить адрес приложения." };
  }
  const redirectUrl = `${origin}/api/channels/${CONNECT_PROVIDER}/connect/callback`;

  const nonce = createConnectNonce();
  const state = signConnectState({
    workspaceId: workspace.workspaceId,
    platform,
    name,
    nonce,
  });

  const cookieStore = await cookies();
  cookieStore.set(CONNECT_STATE_NONCE_COOKIE, nonce, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: CONNECT_STATE_TTL_SECONDS,
  });

  try {
    const url = await adapter.getConnectUrl({
      workspaceId: workspace.workspaceId,
      platform,
      redirectUrl,
      state,
    });

    return { ok: true, url };
  } catch (error) {
    console.error("[settings/channels] failed to build connect url", error);
    return { ok: false, error: "Не удалось начать подключение канала." };
  }
}

/** Absolute origin of the current request, for building the OAuth redirect URI. */
async function resolveRequestOrigin(): Promise<string | null> {
  const headerStore = await headers();
  const host = headerStore.get("x-forwarded-host") ?? headerStore.get("host");

  if (!host) {
    return null;
  }

  const proto =
    headerStore.get("x-forwarded-proto") ??
    (process.env.NODE_ENV === "production" ? "https" : "http");

  return `${proto}://${host}`;
}

export async function renameChannelConnectionAction(input: {
  id: string;
  name: string;
}): Promise<ChannelConnectionResult<ChannelConnectionRow>> {
  const workspace = await requireCurrentWorkspaceId();

  if (!workspace.ok) {
    return workspace;
  }

  const supabase = await createServerSupabaseClient();
  const result = await renameChannelConnection(
    supabase,
    workspace.workspaceId,
    input.id,
    input.name,
  );

  if (result.ok) {
    revalidatePath(SETTINGS_PATH);
  }

  return result;
}

export async function setChannelConnectionStatusAction(input: {
  id: string;
  status: SettableChannelConnectionStatus;
}): Promise<ChannelConnectionResult<ChannelConnectionRow>> {
  const workspace = await requireCurrentWorkspaceId();

  if (!workspace.ok) {
    return workspace;
  }

  const supabase = await createServerSupabaseClient();
  const result = await setChannelConnectionStatus(
    supabase,
    workspace.workspaceId,
    input.id,
    input.status,
  );

  if (result.ok) {
    revalidatePath(SETTINGS_PATH);
  }

  return result;
}
