import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
// Emitted fail-safe after the DB work; irrelevant to what is asserted here.
vi.mock("@/lib/inngest/events", () => ({
  emitContactAvatarSyncRequested: async () => {},
  emitPostThumbnailSyncRequested: async () => {},
  emitPushNotifyRequested: async () => {},
}));

const { processInboundEvent } = await import("./process-event");

import type { SupabaseClient } from "@supabase/supabase-js";

import type { NormalizedEvent } from "@/lib/channels/types";

type Row = Record<string, unknown>;
type Filter = { column: string; value: unknown; op: "eq" | "is" | "in" };

/**
 * Достаточно Postgres, чтобы прогнать эти сценарии: таблицы в памяти, цепочка
 * `.from().select().eq()…`, `maybeSingle`/`single` и await в конце.
 *
 * Полноценного тестового Postgres у юнит-слоя нет (RLS-набор ходит в настоящий,
 * см. `tests/rls`), а проверять здесь надо именно ветвление кода, а не SQL.
 */
function createSupabaseStub(tables: Record<string, Row[]>) {
  let sequence = 0;

  const nextId = (table: string) => `${table}-${(sequence += 1)}`;

  const matches = (row: Row, filters: Filter[]) =>
    filters.every((filter) => {
      const value = row[filter.column];
      if (filter.op === "is") return value === filter.value;
      if (filter.op === "in") return (filter.value as unknown[]).includes(value);
      return value === filter.value;
    });

  const builder = (table: string) => {
    const rows = (tables[table] ??= []);
    const filters: Filter[] = [];
    let mode: "select" | "insert" | "update" | "delete" = "select";
    let payload: Row = {};
    let inserted: Row[] = [];

    const result = () => {
      if (mode === "insert") {
        return { data: inserted, error: null };
      }

      const selected = rows.filter((row) => matches(row, filters));

      if (mode === "update") {
        for (const row of selected) Object.assign(row, payload);
      }

      return { data: selected, error: null };
    };

    const chain: Record<string, unknown> = {
      select() {
        return chain;
      },
      insert(values: Row | Row[]) {
        mode = "insert";
        inserted = (Array.isArray(values) ? values : [values]).map((value) => {
          const row = { id: nextId(table), ...value };
          rows.push(row);
          return row;
        });
        return chain;
      },
      update(values: Row) {
        mode = "update";
        payload = values;
        return chain;
      },
      eq(column: string, value: unknown) {
        filters.push({ column, value, op: "eq" });
        return chain;
      },
      is(column: string, value: unknown) {
        filters.push({ column, value, op: "is" });
        return chain;
      },
      in(column: string, value: unknown[]) {
        filters.push({ column, value, op: "in" });
        return chain;
      },
      maybeSingle() {
        const { data } = result();
        return Promise.resolve({ data: data[0] ?? null, error: null });
      },
      single() {
        const { data } = result();
        return Promise.resolve({
          data: data[0] ?? null,
          error: data[0] ? null : { code: "PGRST116" },
        });
      },
      then(resolve: (value: unknown) => unknown) {
        return Promise.resolve(result()).then(resolve);
      },
    };

    return chain;
  };

  return {
    tables,
    client: { from: (table: string) => builder(table) },
  };
}

const ACCOUNT_ID = "acct_ig_55014";

function baseTables(): Record<string, Row[]> {
  return {
    channel_connections: [
      {
        id: "chc_ig",
        workspace_id: "wsp_a",
        provider: "zernio",
        external_id: ACCOUNT_ID,
        status: "active",
      },
    ],
    webhook_events: [],
    contacts: [],
    contact_identities: [],
    conversations: [],
    messages: [],
  };
}

function messageSentEvent(overrides: { providerEventId: string }): NormalizedEvent {
  return {
    type: "message.sent",
    providerEventId: overrides.providerEventId,
    provider: "zernio",
    platform: "instagram",
    externalAccountId: ACCOUNT_ID,
    conversation: { externalId: "zc_conv_77120" },
    participant: { externalId: "ig_user_31220", displayName: "Lena Fischer" },
    message: {
      externalId: "zm_msg_88250",
      text: "Здравствуйте! Доставка по Берлину — 4 евро.",
      attachments: [],
    },
    rawMetadata: {},
  };
}

describe("processInboundEvent — outbound DM lifecycle", () => {
  let stub: ReturnType<typeof createSupabaseStub>;

  beforeEach(() => {
    stub = createSupabaseStub(baseTables());
  });

  // Заглушка реализует ровно ту часть клиента, которой пользуется код под
  // тестом, — до полного `SupabaseClient` ей далеко.
  const run = (event: NormalizedEvent) =>
    processInboundEvent(stub.client as unknown as SupabaseClient, event);

  it("creates the thread on conversation.started and attaches the contact", async () => {
    await run({
      type: "conversation.started",
      providerEventId: "wh_conv_1",
      provider: "zernio",
      platform: "instagram",
      externalAccountId: ACCOUNT_ID,
      conversation: { externalId: "zc_conv_77120" },
      participant: { externalId: "ig_user_31220", displayName: "Lena Fischer" },
      rawMetadata: {},
    });

    expect(stub.tables.conversations).toHaveLength(1);
    const conversation = stub.tables.conversations[0]!;
    expect(conversation.external_id).toBe("zc_conv_77120");
    expect(conversation.contact_id).toBe(stub.tables.contacts[0]!.id);
    // Тред, начатый нами, никакого сообщения ещё не несёт.
    expect(stub.tables.messages).toHaveLength(0);
  });

  it("records a message the operator sent outside drafta", async () => {
    await run(messageSentEvent({ providerEventId: "wh_sent_1" }));

    expect(stub.tables.conversations).toHaveLength(1);
    expect(stub.tables.messages).toHaveLength(1);
    const message = stub.tables.messages[0]!;
    expect(message.direction).toBe("outgoing");
    expect(message.external_id).toBe("zm_msg_88250");
    expect(message.delivery_status).toBe("sent");
  });

  it("does not duplicate a message drafta itself sent", async () => {
    // Путь отправки уже записал строку с тем же провайдерским id — эхо провайдера
    // не должно превратить один ответ в два пузыря.
    stub.tables.conversations.push({
      id: "cnv_existing",
      workspace_id: "wsp_a",
      channel_connection_id: "chc_ig",
      contact_id: null,
      external_id: "zc_conv_77120",
      status: "open",
    });
    stub.tables.messages.push({
      id: "msg_existing",
      workspace_id: "wsp_a",
      conversation_id: "cnv_existing",
      external_id: "zm_msg_88250",
      direction: "outgoing",
      text: "Здравствуйте! Доставка по Берлину — 4 евро.",
      delivery_status: "delivered",
    });

    await run(messageSentEvent({ providerEventId: "wh_sent_2" }));

    expect(stub.tables.messages).toHaveLength(1);
    // И статус остаётся тот, до которого он уже дошёл: `delivered` опережает
    // это событие, откатывать его в `sent` нельзя.
    expect(stub.tables.messages[0]!.delivery_status).toBe("delivered");
  });

  it("attaches the contact to a thread that was created without one", async () => {
    stub.tables.conversations.push({
      id: "cnv_existing",
      workspace_id: "wsp_a",
      channel_connection_id: "chc_ig",
      contact_id: null,
      external_id: "zc_conv_77120",
      status: "open",
    });

    await run(messageSentEvent({ providerEventId: "wh_sent_3" }));

    expect(stub.tables.conversations).toHaveLength(1);
    expect(stub.tables.conversations[0]!.contact_id).toBe(
      stub.tables.contacts[0]!.id,
    );
  });
});
