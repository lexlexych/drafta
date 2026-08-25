import "server-only";

import { resolveChannelAdapter } from "@/lib/channels/registry";
import { createAdminSupabaseClient } from "@/lib/db/admin";

import "@/lib/channels/zernio";

import { inngest } from "../client";

const MAX_PAGES_PER_CONNECTION = 5;

type ConnectionRef = { id: string; workspaceId: string };

async function listActiveConnections(): Promise<ConnectionRef[]> {
  const supabase = createAdminSupabaseClient();
  const { data, error } = await supabase
    .from("channel_connections")
    .select("id, workspace_id")
    .eq("status", "active");
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    workspaceId: row.workspace_id,
  }));
}

export async function backfillConnectionAvatars(input: {
  workspaceId: string;
  channelConnectionId: string;
}): Promise<{ seen: number; updated: number }> {
  const supabase = createAdminSupabaseClient();
  const { data: connection, error: connectionError } = await supabase
    .from("channel_connections")
    .select("provider, platform, external_id, status")
    .eq("workspace_id", input.workspaceId)
    .eq("id", input.channelConnectionId)
    .maybeSingle();
  if (connectionError) throw connectionError;
  if (!connection || connection.status !== "active") {
    return { seen: 0, updated: 0 };
  }

  const adapter = resolveChannelAdapter(connection.provider);
  if (!adapter.listParticipantAvatars) {
    return { seen: 0, updated: 0 };
  }

  const { data: identities, error: identitiesError } = await supabase
    .from("contact_identities")
    .select("id, external_id, avatar_url")
    .eq("workspace_id", input.workspaceId)
    .eq("platform", connection.platform);
  if (identitiesError) throw identitiesError;

  const identityByExternalId = new Map(
    (identities ?? []).map((identity) => [identity.external_id, identity]),
  );
  const found = new Map<string, string | null>();
  let cursor: string | undefined;

  for (let pageNumber = 0; pageNumber < MAX_PAGES_PER_CONNECTION; pageNumber += 1) {
    const page = await adapter.listParticipantAvatars({
      externalAccountId: connection.external_id,
      cursor,
      limit: 100,
    });
    for (const participant of page.participants) {
      if (identityByExternalId.has(participant.participantExternalId)) {
        found.set(participant.participantExternalId, participant.avatarUrl);
      }
    }
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }

  const fetchedAt = new Date().toISOString();
  let updated = 0;
  for (const [externalId, avatarUrl] of found) {
    const identity = identityByExternalId.get(externalId);
    if (!identity) continue;

    const { error } = await supabase
      .from("contact_identities")
      .update({
        ...(avatarUrl ? { avatar_url: avatarUrl } : {}),
        avatar_fetched_at: fetchedAt,
        updated_at: fetchedAt,
      })
      .eq("workspace_id", input.workspaceId)
      .eq("id", identity.id);
    if (error) throw error;
    if (avatarUrl && avatarUrl !== identity.avatar_url) updated += 1;
  }

  return { seen: found.size, updated };
}

/** Weekly refresh also backfills identities created before avatar support. */
export const contactAvatarBackfill = inngest.createFunction(
  {
    id: "contact-avatar-backfill",
    triggers: [{ cron: "20 2 * * 0" }],
    retries: 2,
    concurrency: [{ scope: "env", key: '"contact-avatar-backfill"', limit: 1 }],
  },
  async ({ step }) => {
    const connections = await step.run("list-connections", listActiveConnections);
    let seen = 0;
    let updated = 0;

    for (const connection of connections) {
      const result = await step.run(`sync-${connection.id}`, () =>
        backfillConnectionAvatars({
          workspaceId: connection.workspaceId,
          channelConnectionId: connection.id,
        }),
      );
      seen += result.seen;
      updated += result.updated;
    }

    return { connections: connections.length, seen, updated };
  },
);
