import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// `channel-connections.ts` imports `"server-only"`, which throws outside a
// Next.js build — same reason `route.test.ts` (T-03) neutralizes the marker
// package before importing the module under test.
vi.mock("server-only", () => ({}));

import { DEFAULT_CHANNEL_CAPABILITIES } from "@/lib/channels/capabilities";

// These DB-backed tests need a live local Supabase (`supabase start`,
// `supabase db reset`) reachable through the same env vars production code
// reads (lib/db/env.ts / lib/db/admin.ts) — skipped (not failed) otherwise,
// same convention as app/api/webhooks/[provider]/route.test.ts (T-03) so
// `npm test` stays green in a fresh clone.
const hasLocalSupabaseConfig = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY &&
    process.env.SUPABASE_SECRET_KEY,
);

if (!hasLocalSupabaseConfig) {
  console.warn(
    "[channel-connections.test.ts] skipping DB-backed tests — set NEXT_PUBLIC_SUPABASE_URL, " +
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY to a running local Supabase " +
      "(`supabase start`, values from `supabase status`) to run them.",
  );
}

describe.skipIf(!hasLocalSupabaseConfig)("lib/db/channel-connections", () => {
  let supabase: SupabaseClient;
  let listChannelConnections: typeof import("./channel-connections").listChannelConnections;
  let createChannelConnection: typeof import("./channel-connections").createChannelConnection;
  let getChannelConnection: typeof import("./channel-connections").getChannelConnection;
  let deleteChannelConnection: typeof import("./channel-connections").deleteChannelConnection;
  let renameChannelConnection: typeof import("./channel-connections").renameChannelConnection;
  let setChannelConnectionStatus: typeof import("./channel-connections").setChannelConnectionStatus;
  const workspaceIdsToClean: string[] = [];

  beforeAll(async () => {
    ({
      listChannelConnections,
      createChannelConnection,
      getChannelConnection,
      deleteChannelConnection,
      renameChannelConnection,
      setChannelConnectionStatus,
    } = await import("./channel-connections"));
    const { createAdminSupabaseClient } = await import("./admin");
    // Admin (service_role) client — bypasses RLS on purpose: these tests
    // exercise the business logic in channel-connections.ts (validation,
    // capability defaults, friendly duplicate errors, workspace scoping),
    // not the RLS policy itself. RLS row-level isolation is a separate
    // concern covered by tests/rls/isolation.integration.ts (`npm run
    // test:rls`), which this ticket extends with a channel_connections case.
    supabase = createAdminSupabaseClient();
  });

  afterEach(async () => {
    // workspaces cascade-delete channel_connections (docs/architecture/06-data-model.md
    // "все связи от workspace вниз — с каскадным удалением").
    while (workspaceIdsToClean.length > 0) {
      const workspaceId = workspaceIdsToClean.pop();
      await supabase.from("workspaces").delete().eq("id", workspaceId);
    }
  });

  async function createTestWorkspace(): Promise<string> {
    const { data, error } = await supabase
      .from("workspaces")
      .insert({ name: `T-04 test ${randomUUID()}` })
      .select("id")
      .single();
    if (error) throw error;
    workspaceIdsToClean.push(data.id);
    return data.id;
  }

  it("rejects a second connection of the same platform in one workspace", async () => {
    const workspaceId = await createTestWorkspace();

    const first = await createChannelConnection(supabase, workspaceId, {
      provider: "zernio",
      platform: "whatsapp",
      externalId: "wa_shop_001",
      name: "WhatsApp Магазин",
    });
    const second = await createChannelConnection(supabase, workspaceId, {
      provider: "zernio",
      platform: "whatsapp",
      externalId: "wa_service_002",
      name: "WhatsApp Сервис",
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error).toMatch(/платформы уже подключён/i);

    const list = await listChannelConnections(supabase, workspaceId);
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("WhatsApp Магазин");
  });

  it("fills capabilities with the platform's defaults on creation", async () => {
    const workspaceId = await createTestWorkspace();

    const result = await createChannelConnection(supabase, workspaceId, {
      provider: "zernio",
      platform: "instagram",
      externalId: "ig_shop_001",
      name: "Instagram Магазин",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.capabilities).toEqual(DEFAULT_CHANNEL_CAPABILITIES.instagram);
    expect(result.data.provider).toBe("zernio");
    expect(result.data.status).toBe("active");
  });

  it("rejects a duplicate (workspace, provider, external_id) with a friendly error, keeps the original row", async () => {
    const workspaceId = await createTestWorkspace();

    const first = await createChannelConnection(supabase, workspaceId, {
      provider: "zernio",
      platform: "telegram",
      externalId: "tg_dup_001",
      name: "Telegram Первый",
    });
    expect(first.ok).toBe(true);

    const duplicate = await createChannelConnection(supabase, workspaceId, {
      provider: "zernio",
      platform: "telegram",
      externalId: "tg_dup_001",
      name: "Telegram Второй",
    });

    expect(duplicate.ok).toBe(false);
    if (duplicate.ok) return;
    expect(duplicate.error).toMatch(/уже подключён|уже используется/i);

    const list = await listChannelConnections(supabase, workspaceId);
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("Telegram Первый");
  });

  it("rejects an empty name, an empty external id, and an unsupported platform", async () => {
    const workspaceId = await createTestWorkspace();

    const emptyName = await createChannelConnection(supabase, workspaceId, {
      provider: "zernio",
      platform: "telegram",
      externalId: "tg_validation_001",
      name: "   ",
    });
    expect(emptyName.ok).toBe(false);

    const emptyExternalId = await createChannelConnection(supabase, workspaceId, {
      provider: "zernio",
      platform: "telegram",
      externalId: "  ",
      name: "Telegram",
    });
    expect(emptyExternalId.ok).toBe(false);

    const unsupportedPlatform = await createChannelConnection(supabase, workspaceId, {
      provider: "zernio",
      platform: "signal",
      externalId: "sig_001",
      name: "Signal",
    });
    expect(unsupportedPlatform.ok).toBe(false);

    const list = await listChannelConnections(supabase, workspaceId);
    expect(list).toHaveLength(0);
  });

  it("renames a connection", async () => {
    const workspaceId = await createTestWorkspace();
    const created = await createChannelConnection(supabase, workspaceId, {
      provider: "zernio",
      platform: "facebook",
      externalId: "fb_page_001",
      name: "Facebook Старое имя",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const renamed = await renameChannelConnection(
      supabase,
      workspaceId,
      created.data.id,
      "Facebook Новое имя",
    );

    expect(renamed.ok).toBe(true);
    if (!renamed.ok) return;
    expect(renamed.data.name).toBe("Facebook Новое имя");

    const list = await listChannelConnections(supabase, workspaceId);
    expect(list[0].name).toBe("Facebook Новое имя");
  });

  it("rejects renaming to an empty name", async () => {
    const workspaceId = await createTestWorkspace();
    const created = await createChannelConnection(supabase, workspaceId, {
      provider: "zernio",
      platform: "facebook",
      externalId: "fb_page_002",
      name: "Facebook Страница",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const renamed = await renameChannelConnection(supabase, workspaceId, created.data.id, "  ");
    expect(renamed.ok).toBe(false);

    const list = await listChannelConnections(supabase, workspaceId);
    expect(list[0].name).toBe("Facebook Страница");
  });

  it("toggles status disconnected/active without deleting the row", async () => {
    const workspaceId = await createTestWorkspace();
    const created = await createChannelConnection(supabase, workspaceId, {
      provider: "zernio",
      platform: "telegram",
      externalId: "tg_toggle_001",
      name: "Telegram Toggle",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const disconnected = await setChannelConnectionStatus(
      supabase,
      workspaceId,
      created.data.id,
      "disconnected",
    );
    expect(disconnected.ok).toBe(true);
    if (!disconnected.ok) return;
    expect(disconnected.data.status).toBe("disconnected");

    // Still present — disabling is a status change, not a delete
    // (docs/epics/epic_02/T-04-channels-settings.md).
    const afterDisconnect = await listChannelConnections(supabase, workspaceId);
    expect(afterDisconnect).toHaveLength(1);
    expect(afterDisconnect[0].id).toBe(created.data.id);

    const reactivated = await setChannelConnectionStatus(
      supabase,
      workspaceId,
      created.data.id,
      "active",
    );
    expect(reactivated.ok).toBe(true);
    if (!reactivated.ok) return;
    expect(reactivated.data.status).toBe("active");
  });

  it("scopes rename/status changes to the given workspace id — a foreign workspace id can't touch someone else's connection", async () => {
    const workspaceId = await createTestWorkspace();
    const foreignWorkspaceId = await createTestWorkspace();

    const created = await createChannelConnection(supabase, workspaceId, {
      provider: "zernio",
      platform: "telegram",
      externalId: "tg_scope_001",
      name: "Telegram Scope",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    // Mirrors what would happen if a server action resolved the *caller's*
    // workspace id to someone else's by mistake: the explicit workspace_id
    // filter (defense in depth on top of RLS) means the row is reported as
    // "not found", not modified.
    const renamed = await renameChannelConnection(
      supabase,
      foreignWorkspaceId,
      created.data.id,
      "Hijacked name",
    );
    expect(renamed.ok).toBe(false);
    if (renamed.ok) return;
    expect(renamed.error).toMatch(/не найдено/i);

    const statusChange = await setChannelConnectionStatus(
      supabase,
      foreignWorkspaceId,
      created.data.id,
      "disconnected",
    );
    expect(statusChange.ok).toBe(false);

    const list = await listChannelConnections(supabase, workspaceId);
    expect(list[0].name).toBe("Telegram Scope");
    expect(list[0].status).toBe("active");
  });

  it("reads one connection, and reports a foreign or unknown id as missing", async () => {
    const workspaceId = await createTestWorkspace();
    const foreignWorkspaceId = await createTestWorkspace();

    const created = await createChannelConnection(supabase, workspaceId, {
      provider: "zernio",
      platform: "instagram",
      externalId: "ig_get_001",
      name: "Instagram Get",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const found = await getChannelConnection(supabase, workspaceId, created.data.id);
    expect(found?.external_id).toBe("ig_get_001");
    expect(found?.provider).toBe("zernio");

    expect(
      await getChannelConnection(supabase, foreignWorkspaceId, created.data.id),
    ).toBeNull();
    expect(await getChannelConnection(supabase, workspaceId, randomUUID())).toBeNull();
  });

  it("deletes a connection and drops its conversations with it", async () => {
    const workspaceId = await createTestWorkspace();

    const created = await createChannelConnection(supabase, workspaceId, {
      provider: "zernio",
      platform: "instagram",
      externalId: "ig_delete_001",
      name: "Instagram Delete",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const { error: conversationError } = await supabase
      .from("conversations")
      .insert({
        workspace_id: workspaceId,
        channel_connection_id: created.data.id,
        external_id: "ig_thread_delete_001",
      });
    expect(conversationError).toBeNull();

    const deleted = await deleteChannelConnection(
      supabase,
      workspaceId,
      created.data.id,
    );
    expect(deleted.ok).toBe(true);

    expect(await listChannelConnections(supabase, workspaceId)).toHaveLength(0);
    const { data: conversations } = await supabase
      .from("conversations")
      .select("id")
      .eq("channel_connection_id", created.data.id);
    expect(conversations ?? []).toHaveLength(0);
  });

  it("strips the deleted channel from the categories that referenced it", async () => {
    const workspaceId = await createTestWorkspace();

    const deletedChannel = await createChannelConnection(supabase, workspaceId, {
      provider: "zernio",
      platform: "instagram",
      externalId: "ig_category_001",
      name: "Instagram Категории",
    });
    const keptChannel = await createChannelConnection(supabase, workspaceId, {
      provider: "zernio",
      platform: "telegram",
      externalId: "tg_category_001",
      name: "Telegram Категории",
    });
    expect(deletedChannel.ok && keptChannel.ok).toBe(true);
    if (!deletedChannel.ok || !keptChannel.ok) return;

    // A workspace always owns exactly one (last) default category — the
    // invariant trigger from supabase/migrations/20260721120000_… enforces it.
    const { error: categoriesError } = await supabase.from("categories").insert([
      {
        workspace_id: workspaceId,
        name: "Только Instagram",
        description: "Тест удаления канала.",
        priority: 0,
        channel_connection_ids: [deletedChannel.data.id],
        is_default: false,
      },
      {
        workspace_id: workspaceId,
        name: "Оба канала",
        description: "Тест удаления канала.",
        priority: 1,
        channel_connection_ids: [deletedChannel.data.id, keptChannel.data.id],
        is_default: false,
      },
      {
        workspace_id: workspaceId,
        name: "По умолчанию",
        description: "Всё, что не подошло под правила выше.",
        priority: 2,
        channel_connection_ids: [],
        is_default: true,
      },
    ]);
    expect(categoriesError).toBeNull();

    const deleted = await deleteChannelConnection(
      supabase,
      workspaceId,
      deletedChannel.data.id,
    );
    expect(deleted.ok).toBe(true);

    const { data: categories } = await supabase
      .from("categories")
      .select("name, channel_connection_ids")
      .eq("workspace_id", workspaceId)
      .order("priority");

    // Nothing dangling is left behind — a stale id would make the category
    // unsaveable (private.validate_category_channels raises 23503).
    expect(
      (categories ?? []).map(
        (category: { name: string; channel_connection_ids: string[] }) => [
          category.name,
          category.channel_connection_ids,
        ],
      ),
    ).toEqual([
      ["Только Instagram", []],
      ["Оба канала", [keptChannel.data.id]],
      ["По умолчанию", []],
    ]);
  });

  it("reports deleting a foreign or unknown connection as missing", async () => {
    const workspaceId = await createTestWorkspace();
    const foreignWorkspaceId = await createTestWorkspace();

    const created = await createChannelConnection(supabase, workspaceId, {
      provider: "zernio",
      platform: "telegram",
      externalId: "tg_delete_scope_001",
      name: "Telegram Scope Delete",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const foreign = await deleteChannelConnection(
      supabase,
      foreignWorkspaceId,
      created.data.id,
    );
    expect(foreign.ok).toBe(false);
    if (foreign.ok) return;
    expect(foreign.error).toMatch(/не найдено/i);

    expect(await listChannelConnections(supabase, workspaceId)).toHaveLength(1);
  });
});
