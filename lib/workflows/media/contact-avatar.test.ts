import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/workflows/leases", () => ({
  acquireLeases: vi.fn().mockResolvedValue(undefined),
  releaseLeases: vi.fn().mockResolvedValue(undefined),
  entityLease: (kind: string, id: string) => ({ key: `${kind}:${id}` }),
}));

const loadAvatarContext = vi.fn();
const fetchAndSaveAvatar = vi.fn();
vi.mock("./contact-avatar.steps", () => ({
  loadAvatarContext: (...args: unknown[]) => loadAvatarContext(...args),
  fetchAndSaveAvatar: (...args: unknown[]) => fetchAndSaveAvatar(...args),
}));

const { contactAvatarWorkflow } = await import("./contact-avatar.workflow");
const { acquireLeases } = await import("@/lib/workflows/leases");

const input = {
  workspaceId: "ws_1",
  contactIdentityId: "ci_1",
  conversationId: "conv_1",
};
const context = {
  provider: "zernio",
  externalAccountId: "acct_1",
  participantExternalId: "p_1",
  conversationExternalId: "c_1",
  currentAvatarUrl: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  loadAvatarContext.mockResolvedValue({ status: "ok", context });
  fetchAndSaveAvatar.mockResolvedValue({ changed: true });
});

describe("contactAvatarWorkflow", () => {
  it("fetches a stale avatar and reports the change", async () => {
    await expect(contactAvatarWorkflow(input)).resolves.toEqual({
      status: "updated",
    });
  });

  it("skips the provider call while the avatar is still fresh", async () => {
    loadAvatarContext.mockResolvedValue({ status: "skip", reason: "still-fresh" });

    await expect(contactAvatarWorkflow(input)).resolves.toEqual({
      status: "skipped",
      reason: "still-fresh",
    });
    expect(fetchAndSaveAvatar).not.toHaveBeenCalled();
  });

  it("reports unchanged when the provider returned the same picture", async () => {
    fetchAndSaveAvatar.mockResolvedValue({ changed: false });

    await expect(contactAvatarWorkflow(input)).resolves.toEqual({
      status: "unchanged",
    });
  });

  it("passes one timestamp to both the staleness check and the write", async () => {
    await contactAvatarWorkflow(input);

    const nowIso = loadAvatarContext.mock.calls[0]?.[1];
    expect(nowIso).toEqual(expect.any(String));
    expect(fetchAndSaveAvatar).toHaveBeenCalledWith(
      expect.objectContaining({ fetchedAtIso: nowIso }),
    );
  });

  it("serialises runs per contact identity", async () => {
    await contactAvatarWorkflow(input);

    expect(acquireLeases).toHaveBeenCalledWith([{ key: "contact-identity:ci_1" }]);
  });
});
