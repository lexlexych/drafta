// Fills one existing workspace with demo data: a fictional massage salon in
// Nuremberg (Instagram + WhatsApp channels, 15 contacts with conversations,
// a 4-category knowledge base and a booking reply template).
//
// Not a migration on purpose: it runs manually, against whichever Supabase
// project the env file points to, and only for the workspace given as the
// argument. Everything it creates hangs off `workspace_id ... on delete
// cascade`, so deleting the workspace removes the demo data completely.
//
// Usage:
//   node --env-file=.env scripts/seed-demo-workspace.mjs <workspace-id>
//   npm run seed:demo -- <workspace-id>
//
// Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY (service role —
// server-side only, never ship this key to a browser).
//
// Channels are fake (external IDs prefixed `demo-`): sending a reply from a
// demo conversation fails at the provider. While a fake channel exists, a real
// channel of the same platform cannot be connected to this workspace.

import { createClient } from "@supabase/supabase-js";

import {
  CHANNELS,
  CONVERSATIONS,
  KNOWLEDGE_BASE,
  REPLY_TEMPLATE,
} from "./demo/massage-salon.mjs";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

const workspaceId = process.argv[2]?.trim();

if (!workspaceId || !UUID_PATTERN.test(workspaceId)) {
  fail("pass the workspace id as the first argument, e.g.\n  npm run seed:demo -- 06d00a63-cd53-4257-a836-e626b604a773");
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;

if (!supabaseUrl || !secretKey) {
  fail("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must be set (run with --env-file=.env)");
}

const db = createClient(supabaseUrl, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function check({ data, error }, what) {
  if (error) {
    throw new Error(`${what}: ${error.message}`);
  }

  return data;
}

async function countRows(table) {
  const { count, error } = await db
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId);

  if (error) {
    throw new Error(`count ${table}: ${error.message}`);
  }

  return count ?? 0;
}

// Rows this run created, for cleanup if a later step fails. Children of
// conversations and contacts (messages, identities) go with them by cascade.
const created = {
  conversations: [],
  contacts: [],
  reply_templates: [],
  kb_files: [],
  channel_connections: [],
};

async function rollback() {
  for (const [table, ids] of Object.entries(created)) {
    if (ids.length === 0) continue;

    const { error } = await db
      .from(table)
      .delete()
      .eq("workspace_id", workspaceId)
      .in("id", ids);

    if (error) {
      console.error(`  rollback of ${table} failed: ${error.message}`);
    }
  }
}

async function ensureChannels() {
  const existing = check(
    await db
      .from("channel_connections")
      .select("id, platform")
      .eq("workspace_id", workspaceId)
      .in("platform", Object.keys(CHANNELS)),
    "load channels",
  );

  const channelIds = {};

  for (const [platform, channel] of Object.entries(CHANNELS)) {
    const found = existing.find((row) => row.platform === platform);

    if (found) {
      channelIds[platform] = found.id;
      console.log(`  ${platform}: using existing channel ${found.id}`);
      continue;
    }

    const row = check(
      await db
        .from("channel_connections")
        .insert({
          workspace_id: workspaceId,
          name: channel.name,
          provider: "zernio",
          platform,
          // Provider account ids route webhooks to a workspace, so the fake id
          // stays unique across workspaces seeded in the same project.
          external_id: `demo-${platform}-${workspaceId}`,
          capabilities: channel.capabilities,
          status: "active",
        })
        .select("id")
        .single(),
      `create ${platform} channel`,
    );

    created.channel_connections.push(row.id);
    channelIds[platform] = row.id;
    console.log(`  ${platform}: created demo channel ${row.id}`);
  }

  return channelIds;
}

async function insertKnowledgeBase() {
  const rows = check(
    await db
      .from("kb_files")
      .insert(
        KNOWLEDGE_BASE.map((entry, index) => ({
          workspace_id: workspaceId,
          name: entry.name,
          content: entry.content,
          sort_order: index,
          is_enabled: true,
        })),
      )
      .select("id"),
    "create knowledge base",
  );

  created.kb_files.push(...rows.map((row) => row.id));
}

async function insertReplyTemplate() {
  const row = check(
    await db
      .from("reply_templates")
      .insert({
        workspace_id: workspaceId,
        name: REPLY_TEMPLATE.name,
        bodies: REPLY_TEMPLATE.bodies,
        is_enabled_for_messages: true,
        is_enabled_for_comments: false,
        sort_order: 0,
      })
      .select("id")
      .single(),
    "create reply template",
  );

  created.reply_templates.push(row.id);
}

async function insertConversation(scenario, index, channelIds, now) {
  const at = (minutesAgo) =>
    new Date(now - minutesAgo * 60_000).toISOString();
  const number = String(index + 1).padStart(2, "0");
  const identityExternalId =
    scenario.platform === "instagram"
      ? `demo-ig-${scenario.contact.handle}`
      : `demo-wa-${scenario.contact.handle}`;
  const firstAt = at(scenario.messages[0][1]);

  const contact = check(
    await db
      .from("contacts")
      .insert({
        workspace_id: workspaceId,
        display_name: scenario.contact.name,
        notes: scenario.contact.notes,
        tags: scenario.contact.tags,
        created_at: firstAt,
      })
      .select("id")
      .single(),
    `create contact ${scenario.contact.name}`,
  );

  created.contacts.push(contact.id);

  const identity = check(
    await db
      .from("contact_identities")
      .insert({
        workspace_id: workspaceId,
        contact_id: contact.id,
        platform: scenario.platform,
        external_id: identityExternalId,
        display_name:
          scenario.platform === "instagram"
            ? scenario.contact.handle
            : scenario.contact.name,
        created_at: firstAt,
      })
      .select("id")
      .single(),
    `create identity ${scenario.contact.name}`,
  );

  const incoming = scenario.messages.filter(([direction]) => direction === "in");
  const lastIncomingAt = at(incoming[incoming.length - 1][1]);

  // Unread = incoming messages after the salon's last reply.
  let unreadCount = 0;
  for (let i = scenario.messages.length - 1; i >= 0; i--) {
    if (scenario.messages[i][0] !== "in") break;
    unreadCount++;
  }

  const lastAt = at(scenario.messages[scenario.messages.length - 1][1]);

  const conversation = check(
    await db
      .from("conversations")
      .insert({
        workspace_id: workspaceId,
        channel_connection_id: channelIds[scenario.platform],
        contact_id: contact.id,
        external_id: `demo-conv-${number}`,
        status: "open",
        last_incoming_at: lastIncomingAt,
        unread_count: unreadCount,
        created_at: firstAt,
        updated_at: lastAt,
      })
      .select("id")
      .single(),
    `create conversation ${scenario.contact.name}`,
  );

  created.conversations.push(conversation.id);

  check(
    await db.from("messages").insert(
      scenario.messages.map(([direction, minutesAgo, text], messageIndex) => {
        const timestamp = at(minutesAgo);
        const base = {
          workspace_id: workspaceId,
          conversation_id: conversation.id,
          external_id: `demo-${number}-${messageIndex + 1}`,
          text,
          created_at: timestamp,
          updated_at: timestamp,
        };

        return direction === "in"
          ? {
              ...base,
              direction: "incoming",
              contact_identity_id: identity.id,
              delivery_status: "received",
            }
          : {
              ...base,
              direction: "outgoing",
              delivery_status: "delivered",
              sent_at: timestamp,
            };
      }),
    ),
    `create messages for ${scenario.contact.name}`,
  );

  return { messages: scenario.messages.length, unread: unreadCount };
}

async function main() {
  console.log(`Supabase: ${new URL(supabaseUrl).host}`);
  console.log(`Workspace: ${workspaceId}`);

  const workspace = check(
    await db
      .from("workspaces")
      .select("id, name")
      .eq("id", workspaceId)
      .maybeSingle(),
    "load workspace",
  );

  if (!workspace) {
    fail("workspace not found in this Supabase project");
  }

  console.log(`Workspace name: ${workspace.name}`);

  for (const table of ["contacts", "kb_files", "reply_templates"]) {
    const count = await countRows(table);

    if (count > 0) {
      fail(
        `workspace already has ${count} row(s) in ${table}. The demo seed only runs on a clean workspace — create a new one or delete this one first.`,
      );
    }
  }

  try {
    console.log("Channels:");
    const channelIds = await ensureChannels();

    await insertKnowledgeBase();
    console.log(`Knowledge base: ${KNOWLEDGE_BASE.length} categories`);

    await insertReplyTemplate();
    console.log(`Reply template: ${REPLY_TEMPLATE.name}`);

    const now = Date.now();
    let messages = 0;
    let unreadConversations = 0;

    for (const [index, scenario] of CONVERSATIONS.entries()) {
      const result = await insertConversation(scenario, index, channelIds, now);
      messages += result.messages;
      if (result.unread > 0) unreadConversations++;
    }

    console.log(
      `Conversations: ${CONVERSATIONS.length} (${unreadConversations} unread), messages: ${messages}`,
    );
    console.log("Done.");
  } catch (error) {
    console.error(`Seed failed: ${error.message}`);
    console.error("Rolling back rows created by this run…");
    await rollback();
    process.exit(1);
  }
}

await main();
