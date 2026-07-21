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
  CONNECT_STATE_COOKIE,
  CONNECT_STATE_NONCE_PARAM,
  CONNECT_STATE_TTL_SECONDS,
  createConnectNonce,
  signConnectState,
} from "@/lib/channels/connect-state";
import type { ChannelPlatform } from "@/lib/channels/types";
import { createAdminSupabaseClient } from "@/lib/db/admin";
import {
  getProviderProfileId,
} from "@/lib/db/channel-provider-profile";
import {
  hasChannelConnectionForPlatform,
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
  | { ok: true; workspaceId: string }
  | { ok: false; error: string }
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
 * Starts connecting a channel: validates the choice and one-platform limit,
 * reads the workspace's provisioned provider profile, asks the provider for
 * its authorization URL, and returns
 * that URL for the client to redirect to. The pending intent is signed and
 * stored in an httpOnly cookie (its nonce is echoed in the redirect_url for a
 * CSRF double-submit). No `channel_connections` row is written yet — the
 * callback route creates it once the account is authorized.
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

  const nonce = createConnectNonce();
  // Our own redirect_url carries the nonce — the provider only appends its
  // own params to it (Zernio doesn't round-trip an arbitrary state).
  const callbackUrl = new URL(
    `${origin}/api/channels/${CONNECT_PROVIDER}/connect/callback`,
  );
  callbackUrl.searchParams.set(CONNECT_STATE_NONCE_PARAM, nonce);

  try {
    const supabase = await createServerSupabaseClient();
    if (
      await hasChannelConnectionForPlatform(
        supabase,
        workspace.workspaceId,
        platform,
      )
    ) {
      return {
        ok: false,
        error: "Канал этой платформы уже подключён к рабочему пространству.",
      };
    }

    // System-managed field (provider profile id) → admin client; the caller
    // is already an authorized member of this workspace.
    const admin = createAdminSupabaseClient();
    const existingProfileId = await getProviderProfileId(
      admin,
      workspace.workspaceId,
      CONNECT_PROVIDER,
    );

    const { url } = await adapter.getConnectUrl({
      platform,
      redirectUrl: callbackUrl.toString(),
      providerProfileId: existingProfileId,
    });

    const state = signConnectState({
      workspaceId: workspace.workspaceId,
      platform,
      name,
      nonce,
    });

    const cookieStore = await cookies();
    cookieStore.set(CONNECT_STATE_COOKIE, state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: CONNECT_STATE_TTL_SECONDS,
    });

    return { ok: true, url };
  } catch (error) {
    console.error("[settings/channels] failed to start channel connection", error);
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
