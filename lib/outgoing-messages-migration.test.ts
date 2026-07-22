import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase",
    "migrations",
    "20260723100000_outgoing_messages.sql",
  ),
  "utf8",
);

describe("outgoing messages migration contract", () => {
  it("relaxes external_id for outgoing rows only", () => {
    expect(migration).toContain("alter column external_id drop not null");
    expect(migration).toContain(
      "check (direction = 'outgoing' or external_id is not null)",
    );
    expect(migration).toContain(
      "check (external_id is null or length(external_id) > 0)",
    );
  });

  it("keeps the webhook matching key unique for known provider IDs", () => {
    expect(migration).toContain(
      "drop constraint messages_conversation_id_external_id_key",
    );
    expect(migration).toContain(
      "create unique index messages_conversation_external_id_key",
    );
    expect(migration).toContain("where external_id is not null");
  });

  it("accepts a reply atomically inside one workspace conversation", () => {
    expect(migration).toContain("create function public.accept_reply_for_send(");
    expect(migration).toContain("security invoker");
    expect(migration).toContain("for update");
    expect(migration).toContain("conversation.workspace_id = target_workspace_id");
    expect(migration).toContain("status = 'sent'");
    expect(migration).toContain("draft.status in ('ready', 'edited')");
    expect(migration).toContain("status = 'superseded'");
  });

  it("creates the outgoing message pending, without a provider ID yet", () => {
    expect(migration).toContain("'outgoing'");
    expect(migration).toContain("'pending'");
    expect(migration).toContain("returning id into outgoing_message_id");
  });

  it("is callable by workspace members under RLS and by the server role", () => {
    expect(migration).toContain(
      "revoke all on function public.accept_reply_for_send(uuid, uuid, text, uuid)",
    );
    expect(migration).toContain("to authenticated, service_role");
  });
});
