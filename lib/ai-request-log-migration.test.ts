import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { AI_REQUEST_LOG_RETENTION_DAYS } from "./db/ai-request-log";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase",
    "migrations",
    "20260803100000_ai_request_log.sql",
  ),
  "utf8",
);

describe("ai_request_log migration", () => {
  it("keeps the log out of the Data API entirely", () => {
    // Unlike ai_usage, these rows carry the workspace system prompt and
    // conversation content. Nothing in the product reads them, so a grant to
    // `authenticated` would only widen the blast radius of a stolen session.
    expect(migration).toContain(
      "revoke all on table public.ai_request_log from anon;",
    );
    expect(migration).toContain(
      "revoke all on table public.ai_request_log from authenticated;",
    );
    expect(migration).toContain(
      "grant select, insert, delete on table public.ai_request_log to service_role;",
    );
    expect(migration).not.toMatch(/grant[^;]*to authenticated/);
    expect(migration).toContain(
      "alter table public.ai_request_log enable row level security;",
    );
  });

  it("cascades from the workspace, so erasure stays one delete", () => {
    expect(migration).toContain(
      "workspace_id uuid not null references public.workspaces(id) on delete cascade",
    );
  });

  it("indexes both read paths: per workspace and by age", () => {
    // The second one is what the retention cron scans.
    expect(migration).toContain(
      "on public.ai_request_log (workspace_id, created_at desc)",
    );
    expect(migration).toContain("on public.ai_request_log (created_at)");
  });

  it("leaves token counts nullable", () => {
    // A failed call reported no usage; storing that as 0 would read as a call
    // that cost nothing. Same distinction AiUsage draws.
    expect(migration).toContain("prompt_tokens integer check");
    expect(migration).toContain("completion_tokens integer check");
    expect(migration).not.toContain("prompt_tokens integer not null");
  });

  it("documents the retention the cron actually enforces", () => {
    expect(AI_REQUEST_LOG_RETENTION_DAYS).toBe(30);
    expect(migration).toContain(
      `Retention: ${AI_REQUEST_LOG_RETENTION_DAYS} days`,
    );
  });
});
