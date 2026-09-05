import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/workflows/leases", () => ({
  acquireLeases: vi.fn().mockResolvedValue(undefined),
  releaseLeases: vi.fn().mockResolvedValue(undefined),
  workspaceLlmLease: (id: string) => ({ key: `workspace:${id}` }),
  entityLease: (kind: string, id: string) => ({ key: `${kind}:${id}` }),
}));

vi.mock("workflow", async (importOriginal) => ({
  ...(await importOriginal<typeof import("workflow")>()),
  getWorkflowMetadata: () => ({ workflowRunId: "wrun_draft_1" }),
}));

const loadDraftContext = vi.fn();
const createGeneratingDraft = vi.fn();
const generateDraftCompletion = vi.fn();
const finalizeDraft = vi.fn();
const failGeneratingDraftsStep = vi.fn();
const resolveGenerationModel = vi.fn();

// Подменяются только шаги с внешними эффектами. Маскирование, размаскирование
// и разбор ответа остаются настоящими — именно они и проверяются.
vi.mock("./generate-draft.steps", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./generate-draft.steps")>()),
  loadDraftContext: (...a: unknown[]) => loadDraftContext(...a),
  createGeneratingDraft: (...a: unknown[]) => createGeneratingDraft(...a),
  generateDraftCompletion: (...a: unknown[]) => generateDraftCompletion(...a),
  finalizeDraft: (...a: unknown[]) => finalizeDraft(...a),
  failGeneratingDraftsStep: (...a: unknown[]) => failGeneratingDraftsStep(...a),
  // Настоящая функция читает ключи провайдера из окружения — в тестах их нет.
  resolveGenerationModel: (...a: unknown[]) => resolveGenerationModel(...a),
}));

const { generateDraftWorkflow } = await import("./generate-draft.workflow");
const {
  resolveMatchedCategoryIds,
  selectAnchorMessages,
  selectBatchMessages,
} = await import("./generate-draft.steps");
import type {
  DraftMessage,
  LoadedDraftContext,
} from "./generate-draft.steps";

const INPUT = {
  workspaceId: "workspace-1",
  conversationId: "conversation-1",
};

function message(
  id: string,
  direction: "incoming" | "outgoing",
  text: string,
): DraftMessage {
  return {
    id,
    direction,
    text,
    createdAt: `2026-07-22T10:00:0${id.at(-1) ?? "0"}.000Z`,
  };
}

function context(
  overrides: Partial<LoadedDraftContext> = {},
): LoadedDraftContext {
  const messages = [
    message("m0", "outgoing", "How can we help?"),
    message("m1", "incoming", "Please call +49 151 23456789"),
  ];

  return {
    workspaceId: "workspace-1",
    conversationId: "conversation-1",
    aiSettings: {
      systemPrompt: "Пиши от лица бизнеса.",
      model: "mistral-large-latest",
    },
    messages,
    batchMessages: [messages[1]!],
    contactNotes: "",
    channelCapabilities: {
      responseWindowHours: null,
      supportsAttachments: true,
      supportsReadReceipts: true,
      maxMessageLength: 4096,
      threadingStyle: "flat",
      supportsComments: false,
      supportsPrivateReply: false,
      privateReplyWindowHours: null,
    },
    knowledgeFiles: [
      {
        id: "kb-1",
        name: "Прайс",
        content: "Hotline: +49 151 23456789. Product Alpha costs 10 EUR.",
        sort_order: 0,
        is_enabled: true,
      },
      {
        id: "kb-2",
        name: "Внутреннее",
        content: "Internal notes.",
        sort_order: 1,
        is_enabled: false,
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  loadDraftContext.mockResolvedValue(context());
  createGeneratingDraft.mockResolvedValue("draft-1");
  generateDraftCompletion.mockResolvedValue(
    "CATEGORIES: Прайс\n\nWe will call {{PHONE_1}}.",
  );
  finalizeDraft.mockResolvedValue(undefined);
  failGeneratingDraftsStep.mockResolvedValue(undefined);
  resolveGenerationModel.mockImplementation((requested: string) => requested);
});

describe("generateDraftWorkflow", () => {
  it("masks the context, restores the completion and expands the categories", async () => {
    const result = await generateDraftWorkflow(INPUT);

    expect(result).toEqual({ status: "ready", draftId: "draft-1" });

    // Модель видит плейсхолдер, а не телефон. Проверяется ровно то, что уедет
    // в промпт: тексты сообщений и база знаний. Сырое значение остаётся только
    // в карте `entities`, которой прогон потом размаскирует ответ.
    const masked = generateDraftCompletion.mock.calls[0]?.[0].maskedContext;
    const promptSources = JSON.stringify([
      masked.messages,
      masked.knowledgeBase.text,
      masked.contactNotes,
      masked.aiSettings,
    ]);
    expect(promptSources).not.toContain("+49 151 23456789");
    expect(promptSources).toContain("{{PHONE_1}}");
    expect(promptSources).toContain("Product Alpha costs 10 EUR");
    expect(masked.knowledgeBase.usedFileIds).toEqual(["kb-1"]);
    expect(masked.entities).toContainEqual(
      expect.objectContaining({ placeholder: "{{PHONE_1}}", kind: "phone" }),
    );

    // Категория названа моделью и развёрнута в id базы знаний, текст размаскирован.
    expect(finalizeDraft).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      draftId: "draft-1",
      text: "We will call +49 151 23456789.",
      model: "mistral-large-latest",
      manualReviewReason: null,
      matchedKbFileIds: ["kb-1"],
    });
  });

  it("returns without a draft when the conversation has nothing incoming", async () => {
    loadDraftContext.mockResolvedValue(null);

    await expect(generateDraftWorkflow(INPUT)).resolves.toEqual({
      status: "skipped",
      reason: "no-incoming",
    });
    expect(createGeneratingDraft).not.toHaveBeenCalled();
  });

  it("stores the reason and an empty draft when the model declines to invent facts", async () => {
    generateDraftCompletion.mockResolvedValue(
      "CATEGORIES:\n\nNEEDS_MANUAL_REVIEW: В базе знаний нет срока доставки.",
    );

    await generateDraftWorkflow(INPUT);

    expect(finalizeDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "",
        manualReviewReason: "В базе знаний нет срока доставки.",
        matchedKbFileIds: [],
      }),
    );
  });

  it("uses and persists the provider-resolved model instead of ai_settings.model", async () => {
    resolveGenerationModel.mockReturnValue("mistralai/mistral-small-2603");

    await generateDraftWorkflow(INPUT);

    expect(generateDraftCompletion).toHaveBeenCalledWith(
      expect.objectContaining({ model: "mistralai/mistral-small-2603" }),
    );
    expect(finalizeDraft).toHaveBeenCalledWith(
      expect.objectContaining({ model: "mistralai/mistral-small-2603" }),
    );
  });

  it("records the run id so «стоп» has something to cancel", async () => {
    await generateDraftWorkflow(INPUT);

    expect(createGeneratingDraft).toHaveBeenCalledWith(
      expect.objectContaining({ workflowRunId: "wrun_draft_1" }),
    );
  });

  it("clears the generating draft when the run gives up", async () => {
    generateDraftCompletion.mockRejectedValue(new Error("provider down"));

    await expect(generateDraftWorkflow(INPUT)).rejects.toThrow("provider down");
    expect(failGeneratingDraftsStep).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      conversationId: "conversation-1",
    });
  });
});

describe("selectBatchMessages", () => {
  it("uses only incoming messages after the latest outgoing message", () => {
    const messages = [
      message("m1", "incoming", "old"),
      message("m2", "outgoing", "answered"),
      message("m3", "incoming", "new one"),
      message("m4", "incoming", "new two"),
    ];

    expect(selectBatchMessages(messages).map(({ id }) => id)).toEqual([
      "m3",
      "m4",
    ]);
  });
});

describe("selectAnchorMessages", () => {
  it("keeps the un-replied batch when there is one", () => {
    const messages = [
      message("m1", "outgoing", "answered"),
      message("m2", "incoming", "new one"),
      message("m3", "incoming", "new two"),
    ];

    expect(selectAnchorMessages(messages).map(({ id }) => id)).toEqual([
      "m2",
      "m3",
    ]);
  });

  it("falls back to the last incoming message when we answered last", () => {
    // Кнопку жмут и в диалоге, где последнее слово было нашим — генерация не
    // должна молча отказывать.
    const messages = [
      message("m1", "incoming", "question"),
      message("m2", "outgoing", "answered"),
    ];

    expect(selectAnchorMessages(messages).map(({ id }) => id)).toEqual(["m1"]);
  });

  it("returns nothing when the conversation has no incoming message at all", () => {
    expect(selectAnchorMessages([message("m1", "outgoing", "hi")])).toEqual([]);
  });
});

describe("resolveMatchedCategoryIds", () => {
  const files = [
    {
      id: "kb-1",
      name: "Прайс",
      content: "",
      sort_order: 0,
      is_enabled: true,
    },
    {
      id: "kb-2",
      name: "Возврат",
      content: "",
      sort_order: 1,
      is_enabled: false,
    },
  ];

  it("matches names case- and space-insensitively, including a disabled category", () => {
    // Категорию могли выключить уже после генерации — ответ от этого не
    // перестаёт быть осмысленным.
    expect(resolveMatchedCategoryIds(files, [" прайс ", "ВОЗВРАТ"])).toEqual([
      "kb-1",
      "kb-2",
    ]);
  });

  it("drops an invented name instead of failing a finished draft", () => {
    expect(resolveMatchedCategoryIds(files, ["Прайс", "Выдуманная"])).toEqual([
      "kb-1",
    ]);
  });

  it("collapses duplicates", () => {
    expect(resolveMatchedCategoryIds(files, ["Прайс", "Прайс"])).toEqual([
      "kb-1",
    ]);
  });
});
