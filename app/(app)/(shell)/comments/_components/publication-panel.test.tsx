// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CONTEXT, type PublicationDraft } from "@/lib/publications/types";
import { PublicationPanel } from "./publication-panel";
const state = vi.hoisted(() => ({ refresh: undefined as (() => void) | undefined, push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: state.push, replace: state.replace }) }));
vi.mock("@/lib/db/browser", () => ({ createBrowserSupabaseClient: () => ({ channel: () => ({ on: (_event: unknown, _filter: unknown, cb: () => void) => { state.refresh = cb; return { subscribe: () => ({}) }; } }), removeChannel: vi.fn() }) }));
let draft: PublicationDraft;
let fetchMock: ReturnType<typeof vi.fn>;
const id = "a1000000-0000-4000-8000-000000000001";
beforeEach(() => {
  state.push.mockClear(); state.replace.mockClear();
  draft = { id, title: "Публикация", body: "Исходный текст", kind: "image", status: "ready", context: structuredClone(DEFAULT_CONTEXT), asset_ids: [], edited_at: null, updated_at: "2026-09-11" };
  fetchMock = vi.fn(async (_path: string, init?: RequestInit) => {
    if (init?.method === "PATCH") {
      const body = JSON.parse(init.body as string);
      if (body.action === "lock") draft.edited_at = "2026-09-11";
      if (body.action === "save") { draft.body = body.body; draft.asset_ids = body.asset_ids; }
      return Response.json({ ok: true });
    }
    if (init?.method === "POST") return Response.json(draft);
    return Response.json({ drafts: [draft], categories: [{ id: "a4000000-0000-4000-8000-000000000001", name: "Продукт" }], connected: false, authorizedKbIds: [], gptUrl: "https://chatgpt.com/g/test" });
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("publication authoring smoke", () => {
  it("starts with the ChatGPT button and opens a durable draft", async () => {
    render(<PublicationPanel draftId="new" workspaceId="w" />);
    fireEvent.click(screen.getByRole("button", { name: "Создать через ChatGPT" }));
    await waitFor(() => expect(state.replace).toHaveBeenCalledWith(`/comments?draft=${id}`));
  });
  it("locks before manual typing and saves the edited body", async () => {
    render(<PublicationPanel draftId={id} workspaceId="w" />);
    const input = await screen.findByRole("textbox", { name: "Текст публикации" });
    expect((input as HTMLTextAreaElement).readOnly).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Начать ручное редактирование" }));
    await waitFor(() => expect((input as HTMLTextAreaElement).readOnly).toBe(false));
    fireEvent.change(input, { target: { value: "Мой текст" } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить черновик" }));
    await screen.findByText("Сохранено");
    expect(draft.body).toBe("Мой текст");
    const calls = fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH").map(([, init]) => JSON.parse(init!.body as string));
    expect(calls.findIndex(c => c.action === "lock")).toBeLessThan(calls.findIndex(c => c.action === "save"));
  });
  it("does not overwrite unsaved edits when realtime arrives", async () => {
    draft.edited_at = "2026-09-11";
    render(<PublicationPanel draftId={id} workspaceId="w" />);
    const input = await screen.findByRole("textbox", { name: "Текст публикации" });
    fireEvent.change(input, { target: { value: "Несохранённая правка" } });
    draft.body = "Старая серверная версия"; state.refresh?.();
    await waitFor(() => expect((input as HTMLTextAreaElement).value).toBe("Несохранённая правка"));
  });
  it("offers category selection and prevents editing during import", async () => {
    draft.status = "importing";
    render(<PublicationPanel draftId={id} workspaceId="w" />);
    await screen.findByText("Загружаем изображения…");
    const category = screen.getByRole("checkbox", { name: "Продукт" });
    expect(category.closest("fieldset")?.disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Сохранить настройки" }).hasAttribute("disabled")).toBe(true);
  });
});
