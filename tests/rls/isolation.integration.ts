import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getRlsTestConfig } from "../../lib/rls-test-config";
import {
  publicClientTables,
  rlsSeedFixtures,
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
  table: (typeof workspaceSeededTables)[number],
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

  it("denies webhook_events even to a member of its own workspace", async () => {
    const result = await ownerAClient
      .from("webhook_events")
      .select("id")
      .eq("workspace_id", rlsSeedFixtures.ownerA.workspaceId);

    expectDenied(result, "webhook_events must remain server-only");
  });

  it.each(publicClientTables)("denies anonymous access to %s", async (table) => {
    const selectedColumn = table === "workspace_members" ? "workspace_id" : "id";
    const result = await anonymousClient.from(table).select(selectedColumn).limit(1);

    expectDenied(result, `${table}: anon must not receive any rows`);
  });
});
