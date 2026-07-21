import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const getAuthenticatedUser = vi.fn();
const getCurrentWorkspace = vi.fn();
const createZernioWorkspaceProfile = vi.fn();
const deleteZernioWorkspaceProfile = vi.fn();
const rpc = vi.fn();

vi.mock("@/lib/db/workspace", () => ({
  getAuthenticatedUser: (...args: unknown[]) => getAuthenticatedUser(...args),
  getCurrentWorkspace: (...args: unknown[]) => getCurrentWorkspace(...args),
}));
vi.mock("@/lib/channels/zernio", () => ({
  createZernioWorkspaceProfile: (...args: unknown[]) =>
    createZernioWorkspaceProfile(...args),
  deleteZernioWorkspaceProfile: (...args: unknown[]) =>
    deleteZernioWorkspaceProfile(...args),
}));
vi.mock("@/lib/db/admin", () => ({
  createAdminSupabaseClient: () => ({ rpc }),
}));

import { createWorkspaceAction } from "./actions";

beforeEach(() => {
  vi.clearAllMocks();
  getAuthenticatedUser.mockResolvedValue({ id: "user_1" });
  getCurrentWorkspace.mockResolvedValue(null);
  createZernioWorkspaceProfile.mockResolvedValue("prof_1");
  deleteZernioWorkspaceProfile.mockResolvedValue(undefined);
  rpc.mockImplementation(
    (_functionName: string, input: { target_workspace_id: string }) =>
      Promise.resolve({ data: input.target_workspace_id, error: null }),
  );
});

describe("createWorkspaceAction", () => {
  it("provisions an isolated Zernio profile and persists it atomically with the workspace", async () => {
    const result = await createWorkspaceAction({ name: "  Acme  " });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(createZernioWorkspaceProfile).toHaveBeenCalledWith({
      workspaceId: result.workspaceId,
      workspaceName: "Acme",
    });
    expect(rpc).toHaveBeenCalledWith("create_workspace", {
      target_workspace_id: result.workspaceId,
      owner_user_id: "user_1",
      workspace_name: "Acme",
      provider_profiles: { zernio: "prof_1" },
    });
    expect(deleteZernioWorkspaceProfile).not.toHaveBeenCalled();
  });

  it("does not create a workspace when Zernio provisioning fails", async () => {
    createZernioWorkspaceProfile.mockRejectedValue(new Error("Zernio unavailable"));

    const result = await createWorkspaceAction({ name: "Acme" });

    expect(result.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
    expect(deleteZernioWorkspaceProfile).not.toHaveBeenCalled();
  });

  it("deletes the empty Zernio profile when DB bootstrap fails", async () => {
    rpc.mockResolvedValue({ data: null, error: new Error("database unavailable") });

    const result = await createWorkspaceAction({ name: "Acme" });

    expect(result.ok).toBe(false);
    expect(deleteZernioWorkspaceProfile).toHaveBeenCalledWith("prof_1");
  });

  it("rejects unauthenticated and already-onboarded callers before provisioning", async () => {
    getAuthenticatedUser.mockResolvedValueOnce(null);
    expect(await createWorkspaceAction({ name: "Acme" })).toEqual({
      ok: false,
      error: "Сессия истекла — войдите заново.",
    });

    getAuthenticatedUser.mockResolvedValueOnce({ id: "user_1" });
    getCurrentWorkspace.mockResolvedValueOnce({ id: "ws_existing" });
    expect(await createWorkspaceAction({ name: "Acme" })).toEqual({
      ok: false,
      error: "Рабочее пространство уже создано.",
    });
    expect(createZernioWorkspaceProfile).not.toHaveBeenCalled();
  });
});
