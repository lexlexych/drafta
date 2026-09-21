import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ context: vi.fn(), from: vi.fn(), rpc: vi.fn(), send: vi.fn(), load: vi.fn(), action: vi.fn(), selected: vi.fn() }));
vi.mock("./server", async original => ({ ...await original<typeof import("./server")>(), memberContext: mocks.context }));
vi.mock("./authoring-server", () => ({ loadAuthoring: mocks.load, authoringAction: mocks.action, loadSelectedContext: mocks.selected }));
vi.mock("./publishing", () => ({ deliveryStatus: async () => [] }));
vi.mock("@/lib/workflows/start", () => ({ dispatchWorkflow: mocks.send }));
vi.mock("@/lib/workflows/recovery", () => ({ reconcileSubject: vi.fn() }));
import { POST as authoring } from "@/app/api/publications/[id]/authoring/route";
import { POST as publish } from "@/app/api/publications/[id]/publish/route";
import { POST as retryImport } from "@/app/api/publications/[id]/import/route";
import { DEFAULT_AUTHORING } from "./authoring";

const draftId = "a1000000-0000-4000-8000-000000000001";
const jobId = "a2000000-0000-4000-8000-000000000002";
const channelId = "a3000000-0000-4000-8000-000000000003";
const params = { params: Promise.resolve({ id: draftId }) };
function request(body = {}) {
  return new Request(`https://drafta.test/api/publications/${draftId}`, { method: "POST", headers: { origin: "https://drafta.test", "Content-Type": "application/json" }, body: JSON.stringify(body) });
}
function query(data: unknown) {
  const response = { data, error: null };
  const q = { select: vi.fn(), eq: vi.fn(), update: vi.fn(), in: vi.fn(), maybeSingle: vi.fn().mockResolvedValue(response), then: (resolve: (value: unknown) => unknown) => Promise.resolve(response).then(resolve) };
  for (const key of ["select", "eq", "update", "in"] as const) q[key].mockReturnValue(q);
  return q;
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("OPENAI_API_KEY", "test");
  mocks.context.mockResolvedValue({ workspace: { id: "workspace" }, user: { id: "user" }, db: { from: mocks.from, rpc: mocks.rpc } });
  mocks.rpc.mockResolvedValue({ data: [], error: null });
  mocks.send.mockResolvedValue({ ids: ["event"] });
  mocks.load.mockResolvedValue({ state: { revision: 1, active_job_id: jobId, input: { ...DEFAULT_AUTHORING, channelIds: [channelId] } }, job: { id: jobId, kind: "ideas", status: "pending", updated_at: new Date(Date.now() - 660_000).toISOString() } });
});
afterEach(() => vi.unstubAllEnvs());

describe("manual publication retries", () => {
  it("reports dispatch failure without resetting a possibly running generation", async () => {
    mocks.action.mockResolvedValue({ id: jobId, status: "pending" });
    mocks.send.mockRejectedValue(new Error("transport"));
    const q = query(null); mocks.from.mockReturnValue(q);
    const response = await authoring(request({ action: "start", revision: 1, kind: "ideas", requestId: jobId }), params);
    expect(response.status).toBe(503);
    expect(mocks.action).toHaveBeenCalledTimes(1);
    expect(q.update).toHaveBeenCalledWith({ error: expect.stringContaining("Повторить") });
    expect(q.eq).toHaveBeenCalledWith("id", jobId);
  });
  it("resumes a stalled generation using the same ID without resetting checkpoints", async () => {
    expect((await authoring(request({ action: "retry", revision: 1, jobId }), params)).status).toBe(202);
    expect(mocks.action).not.toHaveBeenCalled();
    expect(mocks.send.mock.calls[0][0].data).toEqual({ workspaceId: "workspace", jobId });
  });
  it("rejects a mismatched job ID before dispatch", async () => {
    expect((await authoring(request({ action: "retry", revision: 1, jobId: channelId }), params)).status).toBe(409);
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("allows immediate manual retry when dispatch failed", async () => {
    const current = await mocks.load(); current.job.updated_at = new Date().toISOString(); current.job.error = "Dispatch failed";
    expect((await authoring(request({ action: "retry", revision: 1, jobId }), params)).status).toBe(202);
    expect(mocks.action).not.toHaveBeenCalled();
  });
  it("does not enqueue a second run while recent generation progress exists", async () => {
    const current = await mocks.load(); current.job.updated_at = new Date().toISOString();
    expect((await authoring(request({ action: "retry", revision: 1, jobId }), params)).status).toBe(409);
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("records failed dispatch for a delivery and still dispatches the other destination", async () => {
    mocks.rpc.mockResolvedValue({ data: [{ id: jobId, status: "pending" }, { id: channelId, status: "pending" }], error: null });
    mocks.send.mockRejectedValueOnce(new Error("lost acknowledgement"));
    const q = query(null); mocks.from.mockReturnValue(q);
    expect((await publish(request({ channelIds: [channelId], version: "1" }), params)).status).toBe(202);
    expect(mocks.send).toHaveBeenCalledTimes(2);
    expect(q.update).toHaveBeenCalledWith({ error: expect.stringContaining("Повторить") });
    expect(q.eq).toHaveBeenCalledWith("workspace_id", "workspace");
    expect(q.eq).toHaveBeenCalledWith("id", jobId);
  });
  it("retries only the current import within the workspace", async () => {
    const draft = query({ status: "importing", active_import_id: jobId, edited_at: null });
    const job = query({ id: jobId, status: "pending", created_at: new Date().toISOString() });
    mocks.from.mockReturnValueOnce(draft).mockReturnValueOnce(job);
    expect((await retryImport(request(), params)).status).toBe(202);
    expect(job.eq).toHaveBeenCalledWith("workspace_id", "workspace");
    expect(job.eq).toHaveBeenCalledWith("draft_id", draftId);
    expect(mocks.send.mock.calls[0][0].data).toEqual({ workspaceId: "workspace", importId: jobId });
  });
  it("expires old imports only on user request and asks for fresh files", async () => {
    mocks.from.mockReturnValueOnce(query({ status: "importing", active_import_id: jobId, edited_at: null }))
      .mockReturnValueOnce(query({ id: jobId, status: "pending", created_at: new Date(Date.now() - 300_000).toISOString() }));
    const response = await retryImport(request(), params);
    expect(await response.json()).toMatchObject({ requiresFreshFiles: true });
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledWith("finish_publication_import", { w: "workspace", i: jobId, a: [], failed: true });
  });
  it("does not dispatch inaccessible or manually edited imports", async () => {
    mocks.from.mockReturnValueOnce(query(null)).mockReturnValueOnce(query({ edited_at: new Date().toISOString() }));
    expect((await retryImport(request(), params)).status).toBe(404);
    expect((await retryImport(request(), params)).status).toBe(409);
    expect(mocks.send).not.toHaveBeenCalled();
  });
});
