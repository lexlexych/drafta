import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const rootDirectory = process.cwd();

function readSource(...pathParts: string[]): string {
  return readFileSync(join(rootDirectory, ...pathParts), "utf8");
}

describe("workspace bootstrap boundaries", () => {
  it("keeps workspace creation in a restricted security-definer RPC", () => {
    const migration = readSource(
      "supabase",
      "migrations",
      "20260720130000_create_workspace_rpc.sql",
    );

    expect(migration).toContain("create or replace function public.create_workspace(name text)");
    expect(migration).toContain("security definer");
    expect(migration).toContain("set search_path = ''");
    expect(migration).toContain("current_user_id uuid := auth.uid()");
    expect(migration).toContain("insert into public.workspaces (name)");
    expect(migration).toContain(
      "insert into public.workspace_members (workspace_id, user_id, role)",
    );
    expect(migration).toContain("insert into public.ai_settings (workspace_id)");
    expect(migration).toContain(
      "revoke all on function public.create_workspace(text) from public",
    );
    expect(migration).toContain(
      "grant execute on function public.create_workspace(text) to authenticated",
    );
    expect(migration).not.toContain("public.categories");
  });

  it("uses the RPC from onboarding and keeps the app shell behind both gates", () => {
    const appLayout = readSource("app", "(app)", "layout.tsx");
    const onboarding = readSource("app", "(app)", "onboarding", "page.tsx");
    const form = readSource(
      "app",
      "(app)",
      "onboarding",
      "_components",
      "workspace-form.tsx",
    );
    // T-07: dashboard и остальные разделы живут в группе (shell);
    // второй гейт (наличие workspace) — в её layout.
    const shellLayout = readSource("app", "(app)", "(shell)", "layout.tsx");

    expect(appLayout).toContain("getAuthenticatedUser");
    expect(appLayout).toContain('redirect("/login")');
    expect(onboarding).toContain("getCurrentWorkspace");
    expect(onboarding).toContain('redirect("/dashboard")');
    expect(form).toContain('supabase.rpc("create_workspace"');
    expect(form).not.toContain('.from("workspaces")');
    expect(shellLayout).toContain("getCurrentWorkspace");
    expect(shellLayout).toContain('redirect("/onboarding")');
  });
});
