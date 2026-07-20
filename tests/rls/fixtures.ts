export const rlsSeedFixtures = {
  contactAId: "a0000000-0000-4000-8000-000000000201",
  contactBId: "b0000000-0000-4000-8000-000000000201",
  // supabase/seed.sql — "Telegram Shop B" channel_connection, workspace B.
  channelConnectionBId: "b0000000-0000-4000-8000-000000000101",
  ownerA: {
    email: "owner-a@example.com",
    id: "11111111-1111-4111-8111-111111111111",
    workspaceId: "a0000000-0000-4000-8000-000000000001",
  },
  ownerB: {
    email: "owner-b@example.com",
    id: "22222222-2222-4222-8222-222222222222",
    workspaceId: "b0000000-0000-4000-8000-000000000001",
  },
} as const;

export const workspaceSeededTables = [
  { column: "id", name: "workspaces" },
  { column: "workspace_id", name: "workspace_members" },
  { column: "workspace_id", name: "ai_settings" },
  { column: "workspace_id", name: "channel_connections" },
  { column: "workspace_id", name: "contacts" },
  { column: "workspace_id", name: "contact_identities" },
  { column: "workspace_id", name: "conversations" },
  { column: "workspace_id", name: "messages" },
  { column: "workspace_id", name: "kb_files" },
] as const;

export const publicClientTables = [
  "workspaces",
  "workspace_members",
  "invitations",
  "channel_connections",
  "categories",
  "contacts",
  "contact_identities",
  "conversations",
  "messages",
  "drafts",
  "kb_files",
  "webhook_events",
  "push_subscriptions",
  "notification_settings",
  "ai_settings",
] as const;
