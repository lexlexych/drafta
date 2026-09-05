import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const acquireLeases = vi.fn();
vi.mock("@/lib/workflows/leases", () => ({
  acquireLeases: (...a: unknown[]) => acquireLeases(...a),
  releaseLeases: vi.fn().mockResolvedValue(undefined),
  cronLease: (name: string, ttlSeconds: number) => ({
    key: `cron:${name}`,
    ttlSeconds,
  }),
}));

const listDueDigestRecipients = vi.fn();
const summarizeNewIncoming = vi.fn();
const deliverDigest = vi.fn();
const advanceDigestBoundary = vi.fn();
vi.mock("./digest.steps", () => ({
  listDueDigestRecipients: (...a: unknown[]) => listDueDigestRecipients(...a),
  summarizeNewIncoming: (...a: unknown[]) => summarizeNewIncoming(...a),
  deliverDigest: (...a: unknown[]) => deliverDigest(...a),
  advanceDigestBoundary: (...a: unknown[]) => advanceDigestBoundary(...a),
}));

const { pushDigestWorkflow } = await import("./digest.workflow");

const nonEmpty = { dmCount: 2, commentCount: 0, senders: ["Анна"], hasMoreSenders: false };
const empty = { dmCount: 0, commentCount: 0, senders: [], hasMoreSenders: false };

beforeEach(() => {
  vi.clearAllMocks();
  acquireLeases.mockResolvedValue(undefined);
  advanceDigestBoundary.mockResolvedValue(undefined);
  deliverDigest.mockResolvedValue(true);
  summarizeNewIncoming.mockResolvedValue(nonEmpty);
});

describe("pushDigestWorkflow", () => {
  it("sends one digest per due recipient and advances the boundary", async () => {
    listDueDigestRecipients.mockResolvedValue([
      { workspaceId: "ws-1", userId: "u-1", lastDigestAt: "2026-09-05T09:00:00.000Z" },
    ]);

    await expect(pushDigestWorkflow()).resolves.toEqual({
      processed: 1,
      sent: 1,
      status: "completed",
    });
    expect(deliverDigest).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      userId: "u-1",
      summary: nonEmpty,
    });
    expect(advanceDigestBoundary).toHaveBeenCalledTimes(1);
  });

  it("only sets the baseline on a recipient's first ever run", async () => {
    listDueDigestRecipients.mockResolvedValue([
      { workspaceId: "ws-1", userId: "u-1", lastDigestAt: null },
    ]);

    await expect(pushDigestWorkflow()).resolves.toEqual({
      processed: 1,
      sent: 0,
      status: "completed",
    });
    expect(summarizeNewIncoming).not.toHaveBeenCalled();
    expect(deliverDigest).not.toHaveBeenCalled();
    expect(advanceDigestBoundary).toHaveBeenCalledTimes(1);
  });

  it("advances the boundary but sends nothing when there is no news", async () => {
    listDueDigestRecipients.mockResolvedValue([
      { workspaceId: "ws-1", userId: "u-1", lastDigestAt: "2026-09-05T09:00:00.000Z" },
    ]);
    summarizeNewIncoming.mockResolvedValue(empty);

    await expect(pushDigestWorkflow()).resolves.toEqual({
      processed: 1,
      sent: 0,
      status: "completed",
    });
    expect(deliverDigest).not.toHaveBeenCalled();
    expect(advanceDigestBoundary).toHaveBeenCalledTimes(1);
  });

  it("does not count a recipient with no live subscription as sent", async () => {
    listDueDigestRecipients.mockResolvedValue([
      { workspaceId: "ws-1", userId: "u-1", lastDigestAt: "2026-09-05T09:00:00.000Z" },
    ]);
    deliverDigest.mockResolvedValue(false);

    await expect(pushDigestWorkflow()).resolves.toMatchObject({
      processed: 1,
      sent: 0,
    });
    expect(advanceDigestBoundary).toHaveBeenCalledTimes(1);
  });

  it("stands down when the previous tick is still running", async () => {
    acquireLeases.mockRejectedValue(new Error("Timed out waiting"));

    await expect(pushDigestWorkflow()).resolves.toEqual({
      processed: 0,
      sent: 0,
      status: "already-running",
    });
    expect(listDueDigestRecipients).not.toHaveBeenCalled();
  });

  it("gives every recipient the same window boundary", async () => {
    listDueDigestRecipients.mockResolvedValue([
      { workspaceId: "ws-1", userId: "u-1", lastDigestAt: null },
      { workspaceId: "ws-1", userId: "u-2", lastDigestAt: null },
    ]);

    await pushDigestWorkflow();

    const boundaries = advanceDigestBoundary.mock.calls.map(([arg]) => arg.atIso);
    expect(new Set(boundaries).size).toBe(1);
  });
});
