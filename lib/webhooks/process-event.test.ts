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
type Filter = { column: string; value: unknown; op: "eq" | "is" | "in" | "gte" };
type Order = { column: string; ascending: boolean };

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
      // Хватает строкового сравнения: единственное, что фильтруется по «не
      // раньше чем», — ISO-8601 отметки времени, а они сортируются лексически.
      if (filter.op === "gte") return String(value) >= String(filter.value);
      return value === filter.value;
    });

  const builder = (table: string) => {
    const rows = (tables[table] ??= []);
    const filters: Filter[] = [];
    let mode: "select" | "insert" | "update" | "delete" = "select";
    let payload: Row = {};
    let inserted: Row[] = [];
    let order: Order | null = null;
    let take: number | null = null;

    const result = () => {
      if (mode === "insert") {
        return { data: inserted, error: null };
      }

      let selected = rows.filter((row) => matches(row, filters));

      if (order) {
        const { column, ascending } = order;
        selected = [...selected].sort((a, b) => {
          const left = String(a[column]);
          const right = String(b[column]);
          const compared = left < right ? -1 : left > right ? 1 : 0;
          return ascending ? compared : -compared;
        });
      }

      if (take !== null) {
        selected = selected.slice(0, take);
      }

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
      gte(column: string, value: unknown) {
        filters.push({ column, value, op: "gte" });
        return chain;
      },
      order(column: string, options?: { ascending?: boolean }) {
        order = { column, ascending: options?.ascending !== false };
        return chain;
      },
      limit(count: number) {
        take = count;
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

  const rpcCalls: { name: string; args: Row }[] = [];

  return {
    tables,
    rpcCalls,
    client: {
      from: (table: string) => builder(table),
      // Счётчики непрочитанного двигаются атомарной RPC. Без неё путь входящего
      // сообщения падал бы на ровном месте и тест зеленел бы по ветке с
      // ошибкой, ничего на самом деле не проверив.
      rpc: async (name: string, args: Row) => {
        rpcCalls.push({ name, args });
        return { data: null, error: null };
      },
    },
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

/** ID сообщения на самой платформе — то, что send-эндпоинт вернул drafta. */
const PLATFORM_MESSAGE_ID = "ig_msg_88250";
const SENT_TEXT = "Здравствуйте! Доставка по Берлину — 4 евро.";

function messageSentEvent(overrides: {
  providerEventId: string;
  platformExternalId?: string;
  text?: string;
}): NormalizedEvent {
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
      ...(overrides.platformExternalId
        ? { platformExternalId: overrides.platformExternalId }
        : {}),
      text: overrides.text ?? SENT_TEXT,
      attachments: [],
    },
    rawMetadata: {},
  };
}

/** Тред, в котором уже что-то происходило: обе половины теста пишут в него. */
function existingConversation(): Row {
  return {
    id: "cnv_existing",
    workspace_id: "wsp_a",
    channel_connection_id: "chc_ig",
    contact_id: null,
    external_id: "zc_conv_77120",
    status: "open",
  };
}

/** Строка, которую создала отправка из drafta и которой ещё не проставили ID. */
function pendingOutgoingRow(overrides: Partial<Row> = {}): Row {
  return {
    id: "msg_pending",
    workspace_id: "wsp_a",
    conversation_id: "cnv_existing",
    external_id: null,
    direction: "outgoing",
    text: SENT_TEXT,
    delivery_status: "pending",
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

const WHATSAPP_ACCOUNT_ID = "acct_wa_31207";
/** У WhatsApp внешний ID участника — это `wa_id`, то есть сам номер телефона. */
const WHATSAPP_PARTICIPANT_ID = "491512345678";

function whatsappTables(): Record<string, Row[]> {
  return {
    channel_connections: [
      {
        id: "chc_wa",
        workspace_id: "wsp_a",
        provider: "zernio",
        external_id: WHATSAPP_ACCOUNT_ID,
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

/**
 * Синхронизация истории при подключении номера: тред есть, имени профиля у Meta
 * ещё нет. Контакт заводится под собственным внешним ID — номером телефона.
 */
function whatsappThreadSynced(): NormalizedEvent {
  return {
    type: "conversation.started",
    providerEventId: "wh_wa_started_1",
    provider: "zernio",
    platform: "whatsapp",
    externalAccountId: WHATSAPP_ACCOUNT_ID,
    conversation: { externalId: "zc_wa_conv_1" },
    participant: { externalId: WHATSAPP_PARTICIPANT_ID },
    rawMetadata: {},
  };
}

/** Первое настоящее сообщение — вот с ним Meta наконец присылает profile name. */
function whatsappIncoming(displayName: string): NormalizedEvent {
  return {
    type: "message.received",
    providerEventId: `wh_wa_msg_${displayName}`,
    provider: "zernio",
    platform: "whatsapp",
    externalAccountId: WHATSAPP_ACCOUNT_ID,
    conversation: { externalId: "zc_wa_conv_1" },
    message: {
      externalId: `zm_wa_${displayName}`,
      text: "Добрый день!",
      attachments: [],
      sender: { externalId: WHATSAPP_PARTICIPANT_ID, displayName },
    },
    rawMetadata: {},
  };
}

describe("processInboundEvent — имя контакта появляется позже самого контакта", () => {
  let stub: ReturnType<typeof createSupabaseStub>;

  const run = (event: NormalizedEvent) =>
    processInboundEvent(stub.client as unknown as SupabaseClient, event);

  beforeEach(() => {
    stub = createSupabaseStub(whatsappTables());
  });

  it("называет контакт его внешним ID, пока провайдер не сообщил имени", async () => {
    await run(whatsappThreadSynced());

    expect(stub.tables.contacts[0]!.display_name).toBe(WHATSAPP_PARTICIPANT_ID);
    expect(stub.tables.contact_identities[0]!.display_name).toBeNull();
  });

  it("заменяет эту заглушку, когда имя приходит с первым сообщением", async () => {
    await run(whatsappThreadSynced());
    await run(whatsappIncoming("Anna Weber"));

    // Ровно один контакт: сообщение попало в уже созданную identity, а не
    // завело вторую.
    expect(stub.tables.contacts).toHaveLength(1);
    expect(stub.tables.contacts[0]!.display_name).toBe("Anna Weber");
    expect(stub.tables.contact_identities[0]!.display_name).toBe("Anna Weber");
  });

  it("не трогает имя контакта, которое пришло не из этой identity", async () => {
    await run(whatsappThreadSynced());
    // Так выглядит контакт после ручной склейки: имя у него из другого канала,
    // и заглушкой оно уже не является.
    stub.tables.contacts[0]!.display_name = "Anna Weber (Instagram)";

    await run(whatsappIncoming("Anna"));

    expect(stub.tables.contacts[0]!.display_name).toBe("Anna Weber (Instagram)");
    // Провайдерская метка самой identity при этом обновляется всегда.
    expect(stub.tables.contact_identities[0]!.display_name).toBe("Anna");
  });

  it("не записывает имя, которое лишь повторяет внешний ID", async () => {
    await run(whatsappThreadSynced());
    await run(whatsappIncoming(WHATSAPP_PARTICIPANT_ID));

    expect(stub.tables.contact_identities[0]!.display_name).toBeNull();
    expect(stub.tables.contacts[0]!.display_name).toBe(WHATSAPP_PARTICIPANT_ID);
  });
});

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

  it("recognizes our own send when the echo names it by the provider's own id", async () => {
    // Ровно тот случай, что плодил дубли в проде: send-эндпоинт Zernio вернул ID
    // платформы, а эхо приходит под внутренним ID Zernio.
    stub.tables.conversations.push(existingConversation());
    stub.tables.messages.push({
      id: "msg_ours",
      workspace_id: "wsp_a",
      conversation_id: "cnv_existing",
      external_id: PLATFORM_MESSAGE_ID,
      direction: "outgoing",
      text: SENT_TEXT,
      delivery_status: "sent",
    });

    await run(
      messageSentEvent({
        providerEventId: "wh_sent_4",
        platformExternalId: PLATFORM_MESSAGE_ID,
      }),
    );

    expect(stub.tables.messages).toHaveLength(1);
    expect(stub.tables.messages[0]!.external_id).toBe(PLATFORM_MESSAGE_ID);
  });

  it("adopts the pending row when the echo overtakes the send pipeline", async () => {
    stub.tables.conversations.push(existingConversation());
    stub.tables.messages.push(pendingOutgoingRow());

    await run(
      messageSentEvent({
        providerEventId: "wh_sent_5",
        platformExternalId: PLATFORM_MESSAGE_ID,
      }),
    );

    expect(stub.tables.messages).toHaveLength(1);
    const adopted = stub.tables.messages[0]!;
    // Тот же ID, который вот-вот запишет `mark-sent`, — его update остаётся
    // идемпотентным вместо конфликта по уникальному индексу.
    expect(adopted.external_id).toBe(PLATFORM_MESSAGE_ID);
    // Статус не трогаем: `mark-sent` ищет строку по `delivery_status = pending`.
    expect(adopted.delivery_status).toBe("pending");
  });

  it("does not adopt a pending row with different text", async () => {
    stub.tables.conversations.push(existingConversation());
    stub.tables.messages.push(pendingOutgoingRow());

    await run(
      messageSentEvent({
        providerEventId: "wh_sent_6",
        platformExternalId: PLATFORM_MESSAGE_ID,
        text: "Ответ, отправленный из приложения Instagram",
      }),
    );

    // Наш неотправленный ответ — не этот; сообщение извне становится своей строкой.
    expect(stub.tables.messages).toHaveLength(2);
    expect(stub.tables.messages[0]!.external_id).toBeNull();
  });

  it("does not adopt a pending row older than the adoption window", async () => {
    stub.tables.conversations.push(existingConversation());
    stub.tables.messages.push(
      pendingOutgoingRow({
        created_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      }),
    );

    await run(
      messageSentEvent({
        providerEventId: "wh_sent_7",
        platformExternalId: PLATFORM_MESSAGE_ID,
      }),
    );

    // Строка, час простоявшая без ID, — не гонка с этой отправкой, а зависший
    // ответ; забрать её под чужое эхо значило бы потерять оба сообщения.
    expect(stub.tables.messages).toHaveLength(2);
    expect(stub.tables.messages[0]!.external_id).toBeNull();
  });
});
