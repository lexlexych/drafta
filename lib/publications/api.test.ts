import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), context: vi.fn(), send: vi.fn() }));
vi.mock("@/lib/publications/server", async importOriginal => ({
  ...await importOriginal<typeof import("./server")>(), gptContext: mocks.context,
}));
vi.mock("@/lib/inngest/client", () => ({ inngest: { send: mocks.send } }));
import { GET } from "@/app/api/gpt/knowledge/route";
import { POST } from "@/app/api/gpt/publication-drafts/route";
import { DEFAULT_CONTEXT } from "./types";

function query(result: unknown) {
  const q = { select: vi.fn(), eq: vi.fn(), in: vi.fn(), order: vi.fn(), maybeSingle: vi.fn(), single: vi.fn(), limit: vi.fn() };
  for (const key of ["select","eq","in"] as const) q[key].mockReturnValue(q);
  for (const key of ["maybeSingle","single","order","limit"] as const) q[key].mockResolvedValue(result);
  return q;
}
const draftId = randomUUID();
beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.mockResolvedValue({ db: { from: mocks.from, rpc: mocks.rpc }, grant: { id: "grant", workspace_id: "workspace-a", user_id: "user-a", kb_ids: ["allowed", "not-selected"] } });
});
describe("GPT business endpoints", () => {
  it("intersects the OAuth categories with the draft selection and scopes both queries", async () => {
    const draft = query({ data: { id: draftId, title: "Draft", kind: "image", context: { ...DEFAULT_CONTEXT, kbIds: ["allowed", "not-consented"] }, edited_at: null }, error: null });
    const knowledge = query({ data: [{ id: "allowed", name: "Product", content: "Facts" }], error: null });
    mocks.from.mockReturnValueOnce(draft).mockReturnValueOnce(knowledge);
    const response = await GET(new Request(`https://drafta.test/api/gpt/knowledge?draft_id=${draftId}`));
    const body = await response.json();
    expect(response.status).toBe(200); expect(body.categories).toHaveLength(1); expect(body.unavailable_category_count).toBe(1);
    expect(knowledge.in).toHaveBeenCalledWith("id", ["allowed"]);
    expect(knowledge.eq).toHaveBeenCalledWith("workspace_id", "workspace-a");
    expect(knowledge.eq).toHaveBeenCalledWith("is_enabled", true);
    expect(draft.eq).toHaveBeenCalledWith("created_by", "user-a");
  });
  it("does not query knowledge for an inaccessible draft", async () => {
    mocks.from.mockReturnValue(query({ data: null, error: null }));
    expect((await GET(new Request(`https://drafta.test/api/gpt/knowledge?draft_id=${draftId}`))).status).toBe(404);
    expect(mocks.from).toHaveBeenCalledTimes(1);
  });
  const request = () => new Request("https://drafta.test/api/gpt/publication-drafts", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ draft_id: draftId, request_id: randomUUID(), title: "Title", text: "Text", kind: "image", openaiFileIdRefs: [{ id: "file-one", name: "one.png", mime_type: "image/png", download_link: "https://files.oaiusercontent.com/file-one" }], file_order: ["file-one"] }),
  });
  it("returns conflict without dispatch when the draft was manually edited", async () => {
    mocks.from.mockReturnValue(query({ data: { id: draftId }, error: null }));
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "draft_edited" } });
    expect((await POST(request())).status).toBe(409); expect(mocks.send).not.toHaveBeenCalled();
  });
  it("dispatches only IDs after durable reservation and reports accepted, not ready", async () => {
    mocks.from.mockReturnValueOnce(query({ data: { id: draftId }, error: null }))
      .mockReturnValueOnce(query({ data: { status: "pending" }, error: null }));
    mocks.rpc.mockResolvedValue({ data: "import-id", error: null }); mocks.send.mockResolvedValue({ ids: ["event"] });
    const response = await POST(request()); expect(response.status).toBe(202);
    expect(mocks.send.mock.calls[0][0].data).toEqual({ workspaceId: "workspace-a", importId: "import-id" });
    expect((await response.json()).status).toBe("pending");
  });
  it("does not re-dispatch a completed idempotent import", async () => {
    mocks.from.mockReturnValueOnce(query({ data: { id: draftId }, error: null }))
      .mockReturnValueOnce(query({ data: { status: "ready" }, error: null }));
    mocks.rpc.mockResolvedValue({ data: "import-id", error: null });
    expect((await POST(request())).status).toBe(200); expect(mocks.send).not.toHaveBeenCalled();
  });
});
