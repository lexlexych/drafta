import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const acquireLeases = vi.fn();
const releaseLeases = vi.fn();
vi.mock("@/lib/workflows/leases", () => ({
  acquireLeases: (...args: unknown[]) => acquireLeases(...args),
  releaseLeases: (...args: unknown[]) => releaseLeases(...args),
  cronLease: (name: string, ttlSeconds: number) => ({
    key: `cron:${name}`,
    ttlSeconds,
  }),
}));

const deleteExpiredAiRequestLogs = vi.fn();
// Подменяется только шаг с обращением к БД; `retentionCutoff` — чистая
// функция и проверяется настоящая.
vi.mock("./cleanup-ai-request-log.steps", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("./cleanup-ai-request-log.steps")
  >()),
  deleteExpiredAiRequestLogs: (...args: unknown[]) =>
    deleteExpiredAiRequestLogs(...args),
}));

const { cleanupAiRequestLogWorkflow } = await import(
  "./cleanup-ai-request-log.workflow"
);
const { retentionCutoff } = await import("./cleanup-ai-request-log.steps");

beforeEach(() => {
  vi.clearAllMocks();
  acquireLeases.mockResolvedValue(undefined);
  releaseLeases.mockResolvedValue(undefined);
  deleteExpiredAiRequestLogs.mockResolvedValue(7);
});

describe("cleanupAiRequestLogWorkflow", () => {
  it("deletes expired rows and reports the count", async () => {
    await expect(cleanupAiRequestLogWorkflow()).resolves.toEqual({
      deleted: 7,
      status: "completed",
    });
    expect(deleteExpiredAiRequestLogs).toHaveBeenCalledWith(expect.any(String));
  });

  it("stands down instead of running twice when the previous tick is still going", async () => {
    acquireLeases.mockRejectedValue(new Error("Timed out waiting"));

    await expect(cleanupAiRequestLogWorkflow()).resolves.toEqual({
      deleted: 0,
      status: "already-running",
    });
    expect(deleteExpiredAiRequestLogs).not.toHaveBeenCalled();
    // Лиза не наша — освобождать нечего, иначе прогон снял бы чужой слот.
    expect(releaseLeases).not.toHaveBeenCalled();
  });

  it("does not wait for the lease: the next tick comes tomorrow anyway", async () => {
    await cleanupAiRequestLogWorkflow();

    expect(acquireLeases).toHaveBeenCalledWith(
      [{ key: "cron:cleanup-ai-request-log", ttlSeconds: 1800 }],
      0,
    );
  });

  it("releases the lease when the delete step throws", async () => {
    deleteExpiredAiRequestLogs.mockRejectedValue(new Error("boom"));

    await expect(cleanupAiRequestLogWorkflow()).rejects.toThrow("boom");
    expect(releaseLeases).toHaveBeenCalled();
  });
});

describe("retentionCutoff", () => {
  it("keeps the 30-day retention the table is documented with", () => {
    const cutoff = retentionCutoff(new Date("2026-09-05T03:00:00.000Z"));
    expect(cutoff).toBe("2026-08-06T03:00:00.000Z");
  });
});
