import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const {
  runDraftPipeline,
  resolveMatchedCategoryIds,
  selectAnchorMessages,
  selectBatchMessages,
} = await import("./draft-pipeline");
import type {
  DraftPipelineDependencies,
  DraftPipelineSteps,
  LoadedDraftContext,
  PipelineMessage,
} from "./draft-pipeline";

class TestSteps implements DraftPipelineSteps {
  readonly runs: string[] = [];

  async run<T>(id: string, handler: () => Promise<T> | T): Promise<T> {
    this.runs.push(id);
    return handler();
  }
}

const INPUT = {
  workspaceId: "workspace-1",
  conversationId: "conversation-1",
};

function message(
  id: string,
  direction: "incoming" | "outgoing",
  text: string,
): PipelineMessage {
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

function dependencies(
  overrides: Partial<DraftPipelineDependencies> = {},
): DraftPipelineDependencies {
  return {
    loadContext: vi.fn().mockResolvedValue(context()),
    createGeneratingDraft: vi.fn().mockResolvedValue("draft-1"),
    resolveModel: vi.fn((requestedModel: string) => requestedModel),
    generate: vi
      .fn()
      .mockResolvedValue("CATEGORIES: Прайс\n\nWe will call {{PHONE_1}}."),
    finalizeDraft: vi.fn().mockResolvedValue(undefined),
    failGeneratingDrafts: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("draft pipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("runs the masked KB and context through lib/ai and restores the completion", async () => {
    const steps = new TestSteps();
    let llmPrompt = "";
    const createGeneratingDraft = vi.fn().mockImplementation(({ context }) => {
      expect(context.knowledgeBase.usedFileIds).toEqual(["kb-1"]);
      return "draft-1";
    });
    const generate = vi.fn().mockImplementation((prompt) => {
      llmPrompt = JSON.stringify(prompt);
      return "CATEGORIES: Прайс\n\nWe will call {{PHONE_1}}.";
    });
    const finalizeDraft = vi.fn().mockResolvedValue(undefined);

    const result = await runDraftPipeline(
      INPUT,
      steps,
      dependencies({ createGeneratingDraft, generate, finalizeDraft }),
    );

    expect(result).toEqual({ status: "ready", draftId: "draft-1" });
    // Никакого ожидания перед генерацией: её запускает оператор кнопкой.
    expect(steps.runs).toEqual([
      "load-context",
      "mask",
      "create-generating",
      "generate",
      "restore",
      "parse-completion",
      "finalize",
    ]);
    expect(llmPrompt).not.toContain("+49 151 23456789");
    expect(llmPrompt).toContain("{{PHONE_1}}");
    expect(llmPrompt).toContain("Product Alpha costs 10 EUR");
    // Категория названа моделью и развёрнута в id базы знаний.
    expect(finalizeDraft).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      draftId: "draft-1",
      text: "We will call +49 151 23456789.",
      model: "mistral-large-latest",
      manualReviewReason: null,
      matchedKbFileIds: ["kb-1"],
    });
  });

  it("uses and persists the provider-resolved model instead of ai_settings.model", async () => {
    const generate = vi.fn().mockResolvedValue("Generated response");
    const finalizeDraft = vi.fn().mockResolvedValue(undefined);

    await runDraftPipeline(
      INPUT,
      new TestSteps(),
      dependencies({
        resolveModel: vi.fn().mockReturnValue("mistralai/mistral-small-2603"),
        generate,
        finalizeDraft,
      }),
    );

    expect(generate).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ model: "mistralai/mistral-small-2603" }),
    );
    expect(finalizeDraft).toHaveBeenCalledWith(
      expect.objectContaining({ model: "mistralai/mistral-small-2603" }),
    );
  });

  it("returns without a draft when the conversation has nothing incoming", async () => {
    const createGeneratingDraft = vi.fn();
    const result = await runDraftPipeline(
      INPUT,
      new TestSteps(),
      dependencies({
        loadContext: vi.fn().mockResolvedValue(null),
        createGeneratingDraft,
      }),
    );

    expect(result).toEqual({ status: "skipped", reason: "no-incoming" });
    expect(createGeneratingDraft).not.toHaveBeenCalled();
  });
});

describe("grounding refusal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("stores the reason and an empty draft when the model declines to invent facts", async () => {
    const finalizeDraft = vi.fn().mockResolvedValue(undefined);

    await runDraftPipeline(
      INPUT,
      new TestSteps(),
      dependencies({
        generate: vi
          .fn()
          .mockResolvedValue(
            "CATEGORIES:\n\nNEEDS_MANUAL_REVIEW: В базе знаний нет срока доставки.",
          ),
        finalizeDraft,
      }),
    );

    expect(finalizeDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "",
        manualReviewReason: "В базе знаний нет срока доставки.",
        matchedKbFileIds: [],
      }),
    );
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
