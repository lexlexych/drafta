import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const rootDirectory = process.cwd();

function readSource(...pathParts: string[]): string {
  return readFileSync(join(rootDirectory, ...pathParts), "utf8");
}

describe("workspace bootstrap boundaries", () => {
  it("keeps workspace creation in a service-role-only security-definer RPC", () => {
    const migration = readSource(
      "supabase",
      "migrations",
      "20260721100000_workspace_zernio_profile_and_channel_platform.sql",
    );

    expect(migration).toContain("create function public.create_workspace(");
    expect(migration).toContain("security definer");
    expect(migration).toContain("set search_path = ''");
    expect(migration).toContain("provider_profiles jsonb");
    expect(migration).toContain("provider_profiles ->> 'zernio'");
    expect(migration).toContain("insert into public.workspaces (id, name, settings)");
    expect(migration).toContain(
      "insert into public.workspace_members (workspace_id, user_id, role)",
    );
    expect(migration).toContain("insert into public.ai_settings (workspace_id)");
    expect(migration).toContain(
      "revoke all on function public.create_workspace(uuid, uuid, text, jsonb) from public",
    );
    expect(migration).toContain(
      "grant execute on function public.create_workspace(uuid, uuid, text, jsonb) to service_role",
    );
    expect(migration).not.toContain(
      "grant execute on function public.create_workspace(uuid, uuid, text, jsonb) to authenticated",
    );
    expect(migration).toContain("unique (workspace_id, platform)");
  });

  it("uses server-side provider provisioning from onboarding and keeps the app shell behind both gates", () => {
    const appLayout = readSource("app", "(app)", "layout.tsx");
    const onboarding = readSource("app", "(app)", "onboarding", "page.tsx");
    const form = readSource(
      "app",
      "(app)",
      "onboarding",
      "_components",
      "workspace-form.tsx",
    );
    const action = readSource("app", "(app)", "onboarding", "actions.ts");
    // T-07: dashboard и остальные разделы живут в группе (shell);
    // второй гейт (наличие workspace) — в её layout.
    const shellLayout = readSource("app", "(app)", "(shell)", "layout.tsx");

    expect(appLayout).toContain("getAuthenticatedUser");
    expect(appLayout).toContain('redirect("/login")');
    expect(onboarding).toContain("getCurrentWorkspace");
    expect(onboarding).toContain('redirect("/dashboard")');
    expect(form).toContain("createWorkspaceAction");
    expect(form).not.toContain('.from("workspaces")');
    expect(action).toContain("createZernioWorkspaceProfile");
    expect(action).toContain('admin.rpc("create_workspace"');
    expect(action).toContain("deleteZernioWorkspaceProfile");
    expect(action).toContain("provider_profiles: { zernio: profileId }");
    expect(shellLayout).toContain("getCurrentWorkspace");
    expect(shellLayout).toContain('redirect("/onboarding")');
  });
});
