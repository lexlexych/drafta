import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { decryptCredentials, encryptCredentials } from "@/lib/crypto/credentials";

/**
 * `channel_connection_secrets` — credentials of directly connected providers
 * (a Telegram bot's token and webhook secret), encrypted by
 * `lib/crypto/credentials.ts`. The table is `service_role`-only
 * (supabase/migrations/20260923100000_channel_connection_secrets.sql), so
 * every function here takes the admin client; nothing here is ever sent to
 * the browser.
 */

export async function saveChannelConnectionSecrets(
  admin: SupabaseClient,
  input: {
    workspaceId: string;
    channelConnectionId: string;
    credentials: Record<string, unknown>;
  },
): Promise<void> {
  const { error } = await admin.from("channel_connection_secrets").upsert(
    {
      workspace_id: input.workspaceId,
      channel_connection_id: input.channelConnectionId,
      encrypted_credentials: encryptCredentials(input.credentials),
    },
    { onConflict: "channel_connection_id" },
  );

  if (error) {
    console.error("[channel-secrets] failed to save channel connection secrets", {
      code: error.code,
    });
    throw new Error("Unable to save channel connection secrets.");
  }
}

/**
 * Decrypted credentials of the connection identified by (provider,
 * external_id) — the pair inbound webhooks and outgoing sends know — or
 * `null` when there is no such connection or it has no secrets.
 */
export async function getChannelConnectionSecretsByExternalId(
  admin: SupabaseClient,
  provider: string,
  externalId: string,
): Promise<Record<string, unknown> | null> {
  const { data, error } = await admin
    .from("channel_connections")
    .select("id, channel_connection_secrets(encrypted_credentials)")
    .eq("provider", provider)
    .eq("external_id", externalId)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[channel-secrets] failed to load channel connection secrets", {
      code: error.code,
    });
    throw new Error("Unable to load channel connection secrets.");
  }

  const secrets = (data as {
    channel_connection_secrets:
      | { encrypted_credentials: string }
      | { encrypted_credentials: string }[]
      | null;
  } | null)?.channel_connection_secrets;
  const row = Array.isArray(secrets) ? secrets[0] : secrets;

  return row ? decryptCredentials(row.encrypted_credentials) : null;
}

/**
 * True when a connection for this provider account exists in *any*
 * workspace. Used before connecting a Telegram bot: a bot has one webhook, so
 * the same bot in two workspaces would silently steal the first one's updates.
 */
export async function isProviderAccountConnectedAnywhere(
  admin: SupabaseClient,
  provider: string,
  externalId: string,
): Promise<boolean> {
  const { data, error } = await admin
    .from("channel_connections")
    .select("id")
    .eq("provider", provider)
    .eq("external_id", externalId)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[channel-secrets] failed to check provider account", {
      code: error.code,
    });
    throw new Error("Unable to check the provider account.");
  }

  return data !== null;
}
