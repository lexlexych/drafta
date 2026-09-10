import { describe, expect, it, vi } from "vitest";

// `lib/db/ignored-senders` (the gate below) is server-only; the marker throws
// under the test runner and carries no behaviour worth keeping here.
vi.mock("server-only", () => ({}));

const { journalUnparsedEnvelope } = await import("./journal-unparsed");

import type { SupabaseClient } from "@supabase/supabase-js";

import type { UnparsedEnvelope } from "@/lib/channels/types";

type Row = Record<string, unknown>;

/**
 * Ровно столько Supabase, сколько нужно этому модулю: поиск подключения по
 * (provider, external_id) и вставка в `webhook_events`. Полный стаб живёт в
 * `process-event.test.ts` — тащить его сюда ради двух запросов не за чем.
 */
function createSupabaseStub(
  options: {
    connections?: Row[];
    ignoredSenders?: Row[];
    insertError?: { code?: string };
  } = {},
) {
  const connections = options.connections ?? [];
  const ignoredSenders = options.ignoredSenders ?? [];
  const inserted: Row[] = [];

  const builder = (table: string) => {
    const filters: Array<[string, unknown]> = [];
    const anyOf: Array<[string, readonly unknown[]]> = [];

    const rows = () => (table === "ignored_senders" ? ignoredSenders : connections);

    const chain: Record<string, unknown> = {
      select: () => chain,
      limit: () => chain,
      eq(column: string, value: unknown) {
        filters.push([column, value]);
        return chain;
      },
      in(column: string, values: readonly unknown[]) {
        anyOf.push([column, values]);
        return chain;
      },
      insert(values: Row) {
        if (table === "webhook_events" && !options.insertError) {
          inserted.push(values);
        }
        return Promise.resolve({
          data: null,
          error: options.insertError ?? null,
        });
      },
      maybeSingle() {
        const match = rows().find(
          (row) =>
            filters.every(([column, value]) => row[column] === value) &&
            anyOf.every(([column, values]) => values.includes(row[column])),
        );
        return Promise.resolve({ data: match ?? null, error: null });
      },
    };

    return chain;
  };

  return { inserted, client: { from: builder } as unknown as SupabaseClient };
}

function envelope(overrides: Partial<UnparsedEnvelope> = {}): UnparsedEnvelope {
  return {
    providerEventId: "wh_evt_01HZXREACTION0004",
    externalAccountId: "acct_ig_55014",
    reason: 'Unsupported event type "reaction.received"',
    rawEnvelope: { id: "wh_evt_01HZXREACTION0004", event: "reaction.received" },
    platform: null,
    participantHandles: [],
    ...overrides,
  };
}

describe("journalUnparsedEnvelope", () => {
  it("journals the envelope with its reason, attributed to the account's workspace", async () => {
    const stub = createSupabaseStub({
      connections: [
        { provider: "zernio", external_id: "acct_ig_55014", workspace_id: "wsp_a" },
      ],
    });

    await journalUnparsedEnvelope(stub.client, "zernio", envelope());

    expect(stub.inserted).toHaveLength(1);
    const row = stub.inserted[0]!;
    expect(row.workspace_id).toBe("wsp_a");
    expect(row.provider).toBe("zernio");
    expect(row.processing_error).toBe(
      'Unsupported event type "reaction.received"',
    );
    expect(row.payload).toEqual({
      id: "wh_evt_01HZXREACTION0004",
      event: "reaction.received",
    });
    // Терминальный исход: сегодняшний код откажет этому конверту при любом
    // повторе, поэтому строка не должна попасть в очередь на переобработку.
    expect(row.processed_at).toEqual(expect.any(String));
  });

  it("prefixes the journal key so a later, readable redelivery of the same event is not swallowed as a duplicate", async () => {
    const stub = createSupabaseStub();

    await journalUnparsedEnvelope(stub.client, "zernio", envelope());

    expect(stub.inserted[0]!.external_event_id).toBe(
      "unparsed:wh_evt_01HZXREACTION0004",
    );
  });

  it("journals an envelope that names an account we don't know, without a workspace", async () => {
    const stub = createSupabaseStub();

    await journalUnparsedEnvelope(
      stub.client,
      "zernio",
      envelope({ externalAccountId: "acct_unknown" }),
    );

    expect(stub.inserted).toHaveLength(1);
    expect(stub.inserted[0]!.workspace_id).toBeNull();
  });

  it("falls back to a digest of the envelope when it carried no event id, so provider retries collapse onto one row", async () => {
    const stub = createSupabaseStub();
    const malformed = envelope({
      providerEventId: null,
      externalAccountId: null,
      rawEnvelope: { not: "a zernio envelope" },
    });

    await journalUnparsedEnvelope(stub.client, "zernio", malformed);
    await journalUnparsedEnvelope(stub.client, "zernio", malformed);

    const [first, second] = stub.inserted;
    expect(first!.external_event_id).toMatch(/^unparsed:sha256:[0-9a-f]{64}$/);
    expect(second!.external_event_id).toBe(first!.external_event_id);
  });

  it("never throws when the journal write fails — the delivery still answers 200", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const stub = createSupabaseStub({ insertError: { code: "42P01" } });

    await expect(
      journalUnparsedEnvelope(stub.client, "zernio", envelope()),
    ).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalled();

    consoleError.mockRestore();
  });

  it("stays quiet when the same envelope is journaled twice (unique violation is the outcome it wanted)", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const stub = createSupabaseStub({ insertError: { code: "23505" } });

    await journalUnparsedEnvelope(stub.client, "zernio", envelope());

    expect(consoleError).not.toHaveBeenCalled();

    consoleError.mockRestore();
  });

  describe("исключённые отправители", () => {
    const whatsappConnection = [
      { provider: "zernio", external_id: "acct_wa_31207", workspace_id: "wsp_a" },
    ];

    /** Неразобранный конверт несёт тот же номер и текст, что и разобранный. */
    const whatsappEnvelope = envelope({
      externalAccountId: "acct_wa_31207",
      platform: "whatsapp",
      participantHandles: ["+49 151 2345678", "491512345678"],
    });

    it("не журналирует конверт, если номер в списке исключений", async () => {
      const stub = createSupabaseStub({
        connections: whatsappConnection,
        ignoredSenders: [
          {
            id: "ign_1",
            workspace_id: "wsp_a",
            platform: "whatsapp",
            identifier: "491512345678",
          },
        ],
      });

      await journalUnparsedEnvelope(stub.client, "zernio", whatsappEnvelope);

      expect(stub.inserted).toHaveLength(0);
    });

    it("журналирует как обычно, когда номера в списке нет", async () => {
      const stub = createSupabaseStub({
        connections: whatsappConnection,
        ignoredSenders: [
          {
            id: "ign_1",
            workspace_id: "wsp_a",
            platform: "whatsapp",
            identifier: "491599999999",
          },
        ],
      });

      await journalUnparsedEnvelope(stub.client, "zernio", whatsappEnvelope);

      expect(stub.inserted).toHaveLength(1);
    });

    it("журналирует конверт, платформу которого адаптер не распознал", async () => {
      const stub = createSupabaseStub({
        connections: whatsappConnection,
        ignoredSenders: [
          {
            id: "ign_1",
            workspace_id: "wsp_a",
            platform: "whatsapp",
            identifier: "491512345678",
          },
        ],
      });

      await journalUnparsedEnvelope(
        stub.client,
        "zernio",
        envelope({ externalAccountId: "acct_wa_31207", platform: null }),
      );

      expect(stub.inserted).toHaveLength(1);
    });
  });
});
