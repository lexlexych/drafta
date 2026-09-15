// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CONTEXT, type PublicationDraft } from "@/lib/publications/types";
import { PublicationDrafts } from "./publication-drafts";

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const draft = (id: string, patch: Partial<PublicationDraft>): PublicationDraft => ({
  id, title: "Черновик", body: "", kind: "image", source: "draft", status: "ready", context: structuredClone(DEFAULT_CONTEXT),
  asset_ids: [], edited_at: null, updated_at: "2026-09-01T10:00:00Z", deliveries: [], ...patch,
});
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  router.push.mockClear();
  let drafts = [
    draft("a1", { title: "Осенняя карусель", kind: "carousel", asset_ids: ["x1", "x2"] }),
    draft("a2", { title: "Сценарий ролика", kind: "video" }),
    draft("a3", { title: "Упавший пост", deliveries: [{ channel_id: "c", status: "failed", published_url: null, error: "boom" }] }),
  ];
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "DELETE") { drafts = drafts.filter(d => !url.endsWith(`/${d.id}`)); return Response.json({ ok: true }); }
    return Response.json({ drafts });
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("publication drafts list", () => {
  it("groups drafts with type and status and filters them", async () => {
    const { rerender } = render(<PublicationDrafts filter="all" />);
    expect(await screen.findByText("Осенняя карусель")).toBeTruthy();
    expect(screen.getByText("Ошибка отправки")).toBeTruthy();
    expect(screen.getByText("Карусель")).toBeTruthy();
    rerender(<PublicationDrafts filter="video" />);
    expect(screen.getByText("Сценарий ролика")).toBeTruthy();
    expect(screen.queryByText("Осенняя карусель")).toBeNull();
    rerender(<PublicationDrafts filter="errors" />);
    expect(screen.getByText("Упавший пост")).toBeTruthy();
    expect(screen.queryByText("Сценарий ролика")).toBeNull();
  });

  it("deletes a draft from the trash icon only after confirmation", async () => {
    render(<PublicationDrafts filter="all" selectedId="a1" />);
    await screen.findByText("Осенняя карусель");
    fireEvent.click(screen.getAllByRole("button", { name: "Удалить черновик" })[0]!);
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Удалить окончательно" }));
    await waitFor(() => expect(screen.queryByText("Осенняя карусель")).toBeNull());
    expect(router.push).toHaveBeenCalledWith("/comments");
  });
});
