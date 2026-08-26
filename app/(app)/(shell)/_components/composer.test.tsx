// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

import type { ActiveDraftView } from "@/lib/drafts/types";
import { DRAFT_REALTIME_EVENT } from "@/lib/realtime/draft-panel";

import { Composer } from "./composer";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

vi.mock("../inbox/actions", () => ({
  cancelDraftGenerationAction: vi.fn(),
  discardDraftAction: vi.fn(),
  generateDraftAction: vi.fn(),
  sendManualMessageAction: vi.fn(),
}));

const {
  cancelDraftGenerationAction,
  discardDraftAction,
  generateDraftAction,
  sendManualMessageAction,
} = await import("../inbox/actions");

const WORKSPACE_ID = "workspace-1";
const CONVERSATION_ID = "conversation-1";

function draft(overrides: Partial<ActiveDraftView> = {}): ActiveDraftView {
  return {
    id: "draft-1",
    workspaceId: WORKSPACE_ID,
    conversationId: CONVERSATION_ID,
    status: "ready",
    text: "Здравствуйте! Доставим завтра.",
    model: "mistral-large-latest",
    kbFileIds: ["kb-1"],
    kbFileNames: ["Доставка"],
    manualReviewReason: null,
    createdAt: "2026-08-26T10:00:00.000Z",
    updatedAt: "2026-08-26T10:00:05.000Z",
    ...overrides,
  };
}

/** Тот же путь, которым панель realtime доносит строку `drafts` до треда. */
function emitDraftRow(row: Record<string, unknown>) {
  act(() => {
    window.dispatchEvent(
      new CustomEvent(DRAFT_REALTIME_EVENT, {
        detail: {
          eventType: "UPDATE",
          new: {
            workspace_id: WORKSPACE_ID,
            conversation_id: CONVERSATION_ID,
            ...row,
          },
        },
      }),
    );
  });
}

function renderComposer(initialDraft: ActiveDraftView | null = null) {
  return render(
    <Composer
      conversationId={CONVERSATION_ID}
      workspaceId={WORKSPACE_ID}
      draft={initialDraft}
      placeholder="Написать ответ…"
      replyWindowWarning={null}
    />,
  );
}

const field = () => screen.getByLabelText("Ответ") as HTMLTextAreaElement;
const generateButton = () =>
  screen.queryByRole("button", { name: "Сгенерировать черновик" });

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Composer", () => {
  it("offers generation only while the field is empty", () => {
    renderComposer();

    expect(generateButton()).not.toBeNull();

    fireEvent.change(field(), { target: { value: "Печатаю сам" } });

    // Есть текст — черновик уже не нужен, значок уходит.
    expect(generateButton()).toBeNull();
  });

  it("locks the field and shows the running note until the draft arrives", async () => {
    vi.mocked(generateDraftAction).mockResolvedValue({ ok: true });
    renderComposer();

    fireEvent.click(generateButton()!);

    await waitFor(() =>
      expect(generateDraftAction).toHaveBeenCalledWith(CONVERSATION_ID),
    );
    expect(screen.getByText("Генерация черновика…")).toBeDefined();
    expect(field().disabled).toBe(true);
    expect(generateButton()).toBeNull();

    emitDraftRow({
      id: "draft-1",
      status: "ready",
      text: "Здравствуйте! Доставим завтра.",
      model: "mistral-large-latest",
      created_at: "2026-08-26T10:00:00.000Z",
    });

    // Готовый текст попадает прямо в поле, отдельной панели нет.
    expect(field().value).toBe("Здравствуйте! Доставим завтра.");
    expect(field().disabled).toBe(false);
    expect(screen.queryByText("Генерация черновика…")).toBeNull();
    expect(screen.getByText("AI-черновик")).toBeDefined();
  });

  it("unlocks the field and warns when the run gives up", async () => {
    vi.mocked(generateDraftAction).mockResolvedValue({ ok: true });
    renderComposer();

    fireEvent.click(generateButton()!);
    await waitFor(() => expect(field().disabled).toBe(true));

    emitDraftRow({
      id: "draft-1",
      status: "failed",
      created_at: "2026-08-26T10:00:00.000Z",
    });

    expect(field().disabled).toBe(false);
    expect(generateButton()).not.toBeNull();
  });

  it("does not lock the field when the action refuses", async () => {
    vi.mocked(generateDraftAction).mockResolvedValue({
      ok: false,
      error: "Нет входящих сообщений для ответа.",
    });
    renderComposer();

    fireEvent.click(generateButton()!);

    await waitFor(() => expect(field().disabled).toBe(false));
    expect(generateButton()).not.toBeNull();
  });

  it("restores an unsent draft into the field on mount", () => {
    renderComposer(draft());

    expect(field().value).toBe("Здравствуйте! Доставим завтра.");
    expect(screen.getByText("Доставка")).toBeDefined();
    expect(generateButton()).toBeNull();
  });

  it("keeps the field empty when the model refused to answer", () => {
    renderComposer(
      draft({ text: "", manualReviewReason: "В базе знаний нет срока." }),
    );

    expect(field().value).toBe("");
    expect(screen.getByText("Требуется ручная обработка")).toBeDefined();
    // Писать всё равно придётся руками — значок остаётся доступен.
    expect(generateButton()).not.toBeNull();
  });

  it("clears the field and discards the draft on «удалить»", async () => {
    vi.mocked(discardDraftAction).mockResolvedValue({ ok: true });
    renderComposer(draft());

    fireEvent.click(screen.getByRole("button", { name: "Удалить черновик" }));

    expect(field().value).toBe("");
    expect(generateButton()).not.toBeNull();
    await waitFor(() =>
      expect(discardDraftAction).toHaveBeenCalledWith(
        CONVERSATION_ID,
        "draft-1",
      ),
    );
  });

  it("leaves no note behind after «удалить» a generated draft", async () => {
    vi.mocked(generateDraftAction).mockResolvedValue({ ok: true });
    vi.mocked(discardDraftAction).mockResolvedValue({ ok: true });
    renderComposer();

    fireEvent.click(generateButton()!);
    await waitFor(() => expect(field().disabled).toBe(true));
    emitDraftRow({
      id: "draft-1",
      status: "ready",
      text: "Здравствуйте! Доставим завтра.",
      created_at: "2026-08-26T10:00:00.000Z",
    });

    fireEvent.click(screen.getByRole("button", { name: "Удалить черновик" }));

    // Регрессия: погашенный черновик снова показывался «генерацией», потому что
    // оптимистичная блокировка не снималась приходом готового результата.
    expect(screen.queryByText("Генерация черновика…")).toBeNull();
    expect(screen.queryByText("AI-черновик")).toBeNull();
    expect(field().disabled).toBe(false);
    expect(field().value).toBe("");
  });

  it("shows the refusal and its reason on one strip, without a discard button", () => {
    renderComposer(
      draft({ text: "", manualReviewReason: "В базе знаний нет срока." }),
    );

    expect(screen.getByText("Требуется ручная обработка")).toBeDefined();
    expect(screen.getByText("В базе знаний нет срока.")).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Сгенерировать заново" }),
    ).toBeDefined();
    expect(screen.queryByRole("button", { name: "Удалить черновик" })).toBeNull();
  });

  it("stops a running generation on «стоп»", async () => {
    vi.mocked(generateDraftAction).mockResolvedValue({ ok: true });
    vi.mocked(cancelDraftGenerationAction).mockResolvedValue({ ok: true });
    renderComposer();

    fireEvent.click(generateButton()!);
    await waitFor(() => expect(field().disabled).toBe(true));

    fireEvent.click(screen.getByRole("button", { name: "Остановить генерацию" }));

    await waitFor(() =>
      expect(cancelDraftGenerationAction).toHaveBeenCalledWith(CONVERSATION_ID),
    );
    expect(field().disabled).toBe(false);
    expect(screen.queryByText("Генерация черновика…")).toBeNull();
  });

  it("sends the edited draft text together with its draft id", async () => {
    vi.mocked(sendManualMessageAction).mockResolvedValue({
      ok: true,
      messageId: "message-1",
    });
    const { container } = renderComposer(draft());

    fireEvent.change(field(), { target: { value: "Доставим послезавтра." } });
    fireEvent.submit(container.querySelector("form")!);

    await waitFor(() =>
      expect(sendManualMessageAction).toHaveBeenCalledWith(
        CONVERSATION_ID,
        "Доставим послезавтра.",
        "draft-1",
      ),
    );
    expect(field().value).toBe("");
  });

  it("sends typed text with no draft attached", async () => {
    vi.mocked(sendManualMessageAction).mockResolvedValue({
      ok: true,
      messageId: "message-2",
    });
    const { container } = renderComposer();

    fireEvent.change(field(), { target: { value: "Добрый день!" } });
    fireEvent.submit(container.querySelector("form")!);

    await waitFor(() =>
      expect(sendManualMessageAction).toHaveBeenCalledWith(
        CONVERSATION_ID,
        "Добрый день!",
        null,
      ),
    );
  });
});
