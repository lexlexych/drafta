import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getRlsTestConfig } from "../../lib/rls-test-config";
import {
  publicClientTables,
  rlsSeedFixtures,
  workspaceScopedViews,
  workspaceSeededTables,
} from "./fixtures";

const config = getRlsTestConfig();

function createRlsClient() {
  return createClient(config.url, config.publishableKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}

type RlsClient = ReturnType<typeof createRlsClient>;

const ownerAClient = createRlsClient();
const ownerBClient = createRlsClient();
const anonymousClient = createRlsClient();

function expectEmpty(result: { data: unknown[] | null }, context: string): void {
  expect(result.data ?? [], context).toEqual([]);
}

function expectDenied(
  result: { data: unknown[] | null; error: { message: string } | null },
  context: string,
): void {
  expectEmpty(result, context);
  expect(result.error, context).not.toBeNull();
}

async function signIn(
  client: RlsClient,
  email: string,
  password: string,
): Promise<void> {
  const { error } = await client.auth.signInWithPassword({ email, password });

  if (error) {
    throw new Error(`Could not sign in ${email}: ${error.message}`);
  }
}

async function assertWorkspaceIsVisibleOnlyToOwner(
  client: RlsClient,
  foreignWorkspaceId: string,
  ownWorkspaceId: string,
  table:
    | (typeof workspaceSeededTables)[number]
    | (typeof workspaceScopedViews)[number],
): Promise<void> {
  const selectedColumn = table.column === "id" ? "id" : "workspace_id";
  const ownRows = await client
    .from(table.name)
    .select(selectedColumn)
    .eq(table.column, ownWorkspaceId)
    .limit(1);

  expect(ownRows.error, `${table.name}: own workspace query`).toBeNull();
  expect(ownRows.data, `${table.name}: expected a seeded own row`).toHaveLength(1);

  const foreignRows = await client
    .from(table.name)
    .select(selectedColumn)
    .eq(table.column, foreignWorkspaceId);

  expect(foreignRows.error, `${table.name}: foreign workspace query`).toBeNull();
  expectEmpty(foreignRows, `${table.name}: foreign workspace must be invisible`);
}

async function removeProbeContact(contactId: string): Promise<void> {
  const [ownerAResult, ownerBResult] = await Promise.all([
    ownerAClient.from("contacts").delete().eq("id", contactId),
    ownerBClient.from("contacts").delete().eq("id", contactId),
  ]);

  if (ownerAResult.error && ownerBResult.error) {
    throw new Error(
      `Could not clean up RLS probe ${contactId}: ${ownerAResult.error.message}; ${ownerBResult.error.message}`,
    );
  }
}

const anonymousProbeColumns = {
  workflow_leases: "key",
  workspace_members: "workspace_id",
} as const;

describe("workspace RLS isolation", () => {
  beforeAll(async () => {
    await Promise.all([
      signIn(
        ownerAClient,
        rlsSeedFixtures.ownerA.email,
        config.ownerAPassword,
      ),
      signIn(
        ownerBClient,
        rlsSeedFixtures.ownerB.email,
        config.ownerBPassword,
      ),
    ]);
  });

  afterAll(async () => {
    await Promise.all([ownerAClient.auth.signOut(), ownerBClient.auth.signOut()]);
  });

  it.each(workspaceSeededTables)(
    "$name is isolated for both seeded workspace owners",
    async (table) => {
      await assertWorkspaceIsVisibleOnlyToOwner(
        ownerAClient,
        rlsSeedFixtures.ownerB.workspaceId,
        rlsSeedFixtures.ownerA.workspaceId,
        table,
      );
      await assertWorkspaceIsVisibleOnlyToOwner(
        ownerBClient,
        rlsSeedFixtures.ownerA.workspaceId,
        rlsSeedFixtures.ownerB.workspaceId,
        table,
      );
    },
  );

  it.each(workspaceScopedViews)(
    "$name reads through the RLS of its base table, not around it",
    async (view) => {
      await assertWorkspaceIsVisibleOnlyToOwner(
        ownerAClient,
        rlsSeedFixtures.ownerB.workspaceId,
        rlsSeedFixtures.ownerA.workspaceId,
        view,
      );
      await assertWorkspaceIsVisibleOnlyToOwner(
        ownerBClient,
        rlsSeedFixtures.ownerA.workspaceId,
        rlsSeedFixtures.ownerB.workspaceId,
        view,
      );
    },
  );

  it("rejects INSERT into a foreign workspace", async () => {
    const contactId = randomUUID();

    try {
      const result = await ownerAClient
        .from("contacts")
        .insert({
          display_name: "RLS foreign insert probe",
          id: contactId,
          notes: "Must never be stored in Workspace B",
          tags: ["rls-probe"],
          workspace_id: rlsSeedFixtures.ownerB.workspaceId,
        })
        .select("id");

      expectDenied(result, "INSERT into Workspace B must fail WITH CHECK");
    } finally {
      await removeProbeContact(contactId);
    }
  });

  it("rejects changing a visible row to a foreign workspace", async () => {
    const contactId = randomUUID();
    const created = await ownerAClient
      .from("contacts")
      .insert({
        display_name: "RLS workspace move probe",
        id: contactId,
        notes: "Temporary test fixture",
        tags: ["rls-probe"],
        workspace_id: rlsSeedFixtures.ownerA.workspaceId,
      })
      .select("id")
      .single();

    expect(created.error, "Creating an own probe contact").toBeNull();
    expect(created.data?.id).toBe(contactId);

    try {
      const result = await ownerAClient
        .from("contacts")
        .update({ workspace_id: rlsSeedFixtures.ownerB.workspaceId })
        .eq("id", contactId)
        .select("id");

      expectDenied(result, "UPDATE into Workspace B must fail WITH CHECK");
    } finally {
      await removeProbeContact(contactId);
    }
  });

  it("denies renaming or disabling another workspace's channel_connection (T-04)", async () => {
    const renameAttempt = await ownerAClient
      .from("channel_connections")
      .update({ name: "Hijacked by Workspace A" })
      .eq("id", rlsSeedFixtures.channelConnectionBId)
      .select("id");

    // Unlike the WITH CHECK violation above (moving a *visible* own row into
    // a foreign workspace, which errors), this row is foreign to begin with:
    // RLS's USING clause filters it out before the UPDATE can match it — 0
    // rows affected, no error. Either way, Workspace B's channel_connection
    // must come out unchanged (docs/epics/epic_02/T-04-channels-settings.md
    // acceptance criteria: "Доступ только у участников workspace").
    expect(
      renameAttempt.error,
      "rename attempt on a foreign channel_connection",
    ).toBeNull();
    expectEmpty(
      renameAttempt,
      "rename attempt on a foreign channel_connection must affect 0 rows",
    );

    const statusAttempt = await ownerAClient
      .from("channel_connections")
      .update({ status: "disconnected" })
      .eq("id", rlsSeedFixtures.channelConnectionBId)
      .select("id");

    expect(
      statusAttempt.error,
      "status change attempt on a foreign channel_connection",
    ).toBeNull();
    expectEmpty(
      statusAttempt,
      "status change attempt on a foreign channel_connection must affect 0 rows",
    );

    const stillIntact = await ownerBClient
      .from("channel_connections")
      .select("name, status")
      .eq("id", rlsSeedFixtures.channelConnectionBId)
      .single();

    expect(
      stillIntact.error,
      "owner B re-reading their own channel_connection",
    ).toBeNull();
    expect(stillIntact.data?.name).toBe("Telegram Shop B");
    expect(stillIntact.data?.status).toBe("active");
  });

  it("denies marking another workspace's conversation as read (T-05)", async () => {
    const readAttempt = await ownerAClient
      .from("conversations")
      .update({ unread_count: 0 })
      .eq("id", rlsSeedFixtures.conversationBId)
      .select("id");

    // Same shape as the channel_connection probe above: the row is foreign
    // to begin with, so RLS's USING clause filters it out before the UPDATE
    // can match anything — 0 rows affected, no error. Either way, Workspace
    // B's unread counter must come out unchanged (docs/epics/epic_02/T-05-inbox-messages.md
    // acceptance criteria: opening a thread only resets *its own workspace's*
    // conversation).
    expect(
      readAttempt.error,
      "mark-as-read attempt on a foreign conversation",
    ).toBeNull();
    expectEmpty(
      readAttempt,
      "mark-as-read attempt on a foreign conversation must affect 0 rows",
    );

    const stillIntact = await ownerBClient
      .from("conversations")
      .select("unread_count")
      .eq("id", rlsSeedFixtures.conversationBId)
      .single();

    expect(
      stillIntact.error,
      "owner B re-reading their own conversation",
    ).toBeNull();
    expect(stillIntact.data?.unread_count).toBe(1);
  });

  it("denies updating another workspace's ai_settings (E-003/T-06)", async () => {
    const updateAttempt = await ownerAClient
      .from("ai_settings")
      .update({
        system_prompt: "hijacked",
      })
      .eq("workspace_id", rlsSeedFixtures.ownerB.workspaceId)
      .select("workspace_id");

    expect(
      updateAttempt.error,
      "update attempt on foreign ai_settings",
    ).toBeNull();
    expectEmpty(
      updateAttempt,
      "update attempt on foreign ai_settings must affect 0 rows",
    );

    const stillIntact = await ownerBClient
      .from("ai_settings")
      .select("system_prompt")
      .eq("workspace_id", rlsSeedFixtures.ownerB.workspaceId)
      .single();

    expect(stillIntact.error, "owner B re-reading their AI settings").toBeNull();
    expect(stillIntact.data).toMatchObject({
      system_prompt:
        "Пиши от лица Demo B. Держи деловой стиль и не выдумывай фактов.",
    });
  });

  it("denies webhook_events even to a member of its own workspace", async () => {
    const result = await ownerAClient
      .from("webhook_events")
      .select("id")
      .eq("workspace_id", rlsSeedFixtures.ownerA.workspaceId);

    expectDenied(result, "webhook_events must remain server-only");
  });

  it("lets a member read ai_usage but never write it", async () => {
    // The table is read-only for `authenticated` on purpose: the draft
    // pipelines write it under the service role, so a session that could
    // insert or delete here could only ever forge or erase cost records.
    const readable = await ownerAClient
      .from("ai_usage")
      .select("total_tokens")
      .eq("workspace_id", rlsSeedFixtures.ownerA.workspaceId);

    expect(readable.error, "a member must see their own workspace's usage").toBeNull();
    expect(readable.data?.length ?? 0).toBeGreaterThan(0);

    const inserted = await ownerAClient.from("ai_usage").insert({
      workspace_id: rlsSeedFixtures.ownerA.workspaceId,
      operation: "draft",
      surface: "message",
      provider: "mistral",
      model: "mistral-large-latest",
      prompt_tokens: 1,
      completion_tokens: 1,
      total_tokens: 2,
    });

    expect(inserted.error, "ai_usage must not be writable from a session").not.toBeNull();

    const deleted = await ownerAClient
      .from("ai_usage")
      .delete()
      .eq("workspace_id", rlsSeedFixtures.ownerA.workspaceId)
      .select("id");

    expectDenied(deleted, "ai_usage must not be deletable from a session");
  });

  it("denies ai_request_log even to a member of its own workspace", async () => {
    // Narrower than ai_usage above: these rows hold the prompts and answers
    // verbatim, and nothing in the product reads them. Only the pipelines
    // write, and only an operator reads — through SQL, not the Data API.
    const result = await ownerAClient
      .from("ai_request_log")
      .select("id")
      .eq("workspace_id", rlsSeedFixtures.ownerA.workspaceId);

    expectDenied(result, "ai_request_log must remain server-only");
  });

  it.each(publicClientTables)("denies anonymous access to %s", async (table) => {
    // Почти у всех таблиц есть `id`; исключения — те, где первичный ключ
    // составной или отсутствует, и колонку надо назвать явно.
    const selectedColumn =
      anonymousProbeColumns[table as keyof typeof anonymousProbeColumns] ?? "id";
    const result = await anonymousClient.from(table).select(selectedColumn).limit(1);

    expectDenied(result, `${table}: anon must not receive any rows`);
  });
});
