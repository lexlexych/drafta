import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const {
  MAX_AUTO_REPLY_WAITS,
  runAutoReplyPipeline,
} = await import("./auto-reply-pipeline");
type Module = typeof import("./auto-reply-pipeline");
type AutoReplyDependencies = Module["autoReplyDependencies"];
type ConversationStateSnapshot = Parameters<
  AutoReplyDependencies["loadConversationState"]
> extends unknown
  ? Awaited<ReturnType<AutoReplyDependencies["loadConversationState"]>>
  : never;
type AutoReplyJournalEntry = Parameters<AutoReplyDependencies["journal"]>[0];

const INPUT = {
  workspaceId: "ws-1",
  conversationId: "conv-1",
  messageId: "in-1",
};

/**
 * Шаги без Inngest: запоминают порядок, а «сон» просто записывает дедлайн.
 * Проверяем именно последовательность решений — очередь и провайдер здесь ни
 * при чём.
 */
class TestSteps {
  readonly runs: string[] = [];
  readonly sleeps: { id: string; until: string }[] = [];

  async run<T>(id: string, handler: () => Promise<T> | T): Promise<T> {
    this.runs.push(id);
    return handler();
  }

  async sleepUntil(id: string, until: string): Promise<void> {
    this.sleeps.push({ id, until });
  }
}

function waiting(
  overrides: Partial<Extract<ConversationStateSnapshot, { status: "waiting" }>> = {},
): ConversationStateSnapshot {
  return {
    status: "waiting",
    latestIncomingId: "in-1",
    latestIncomingText: "Сколько стоит доставка?",
    latestIncomingAt: "2026-09-07T10:00:00.000Z",
    messages: [{ direction: "incoming", text: "Сколько стоит доставка?" }],
    ...overrides,
  };
}

const scenario = {
  id: "sc-1",
  name: "Цены",
  condition: "Клиент спрашивает стоимость",
  examples: ["Сколько стоит?"],
  action: "reply" as const,
  replyTemplateId: "tpl-1",
};

let journalled: AutoReplyJournalEntry[] = [];

function dependencies(
  overrides: Partial<AutoReplyDependencies> = {},
): AutoReplyDependencies {
  return {
    loadSettings: vi.fn(async () => ({
      isEnabled: true,
      delayMinutes: 5,
      fallbackTemplateId: null,
    })),
    loadConversationState: vi.fn(async () => waiting()),
    loadScenarios: vi.fn(async () => [scenario]),
    classify: vi.fn(async () => ({
      scenarioIndex: 0,
      confidence: 90,
      language: "ru",
    })),
    loadTemplate: vi.fn(async () => ({
      id: "tpl-1",
      bodies: { ru: "Доставка бесплатная", de: "Versand ist gratis" },
    })),
    createReply: vi.fn(async () => "out-1"),
    requestSend: vi.fn(async () => {}),
    journal: vi.fn(async (entry: AutoReplyJournalEntry) => {
      journalled.push(entry);
    }),
    minConfidence: () => 75,
    random: () => 0,
    ...overrides,
  };
}

beforeEach(() => {
  journalled = [];
});

describe("runAutoReplyPipeline", () => {
  it("waits, classifies, sends the template and journals the decision", async () => {
    const steps = new TestSteps();
    const deps = dependencies();

    const result = await runAutoReplyPipeline(INPUT, steps, deps);

    expect(result).toEqual({ outcome: "sent", replyMessageId: "out-1" });
    // Классификация — после ожидания: оператор чаще успевает ответить сам, и
    // тогда вызов модели не нужен вовсе.
    expect(steps.runs).toEqual([
      "load-settings",
      "check-conversation-0",
      "check-conversation-1",
      "load-scenarios",
      "classify",
      "load-template",
      "create-reply",
      "request-send",
    ]);
    expect(steps.sleeps).toEqual([
      { id: "wait-0", until: "2026-09-07T10:05:00.000Z" },
    ]);
    expect(deps.requestSend).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      conversationId: "conv-1",
      messageId: "out-1",
    });
    expect(journalled).toEqual([
      expect.objectContaining({
        outcome: "sent",
        scenarioId: "sc-1",
        scenarioName: "Цены",
        confidence: 90,
        detectedLanguage: "ru",
        templateId: "tpl-1",
        templateBodyKey: "ru",
        replyMessageId: "out-1",
        decidedForMessageId: "in-1",
      }),
    ]);
  });

  it("stops before the wait when the contour is off", async () => {
    const steps = new TestSteps();

    const result = await runAutoReplyPipeline(
      INPUT,
      steps,
      dependencies({
        loadSettings: vi.fn(async () => ({
          isEnabled: false,
          delayMinutes: 5,
          fallbackTemplateId: null,
        })),
      }),
    );

    expect(result).toEqual({ outcome: "disabled" });
    expect(steps.runs).toEqual(["load-settings"]);
    // Строка в журнале на каждое входящее у выключенного workspace — шум.
    expect(journalled).toEqual([]);
  });

  it("skips the sleep step entirely when the delay is zero", async () => {
    // Нулевая длительность у Inngest не документирована, поэтому «отвечать
    // сразу» — это отсутствие шага, а не сон на ноль.
    const steps = new TestSteps();

    await runAutoReplyPipeline(
      INPUT,
      steps,
      dependencies({
        loadSettings: vi.fn(async () => ({
          isEnabled: true,
          delayMinutes: 0,
          fallbackTemplateId: null,
        })),
      }),
    );

    expect(steps.sleeps).toEqual([]);
  });

  it("stands down when the operator answered during the wait", async () => {
    const result = await runAutoReplyPipeline(
      INPUT,
      new TestSteps(),
      dependencies({
        loadConversationState: vi.fn(async () => ({
          status: "operator-replied" as const,
        })),
      }),
    );

    expect(result).toEqual({ outcome: "cancelled_by_operator" });
    expect(journalled).toEqual([
      expect.objectContaining({ outcome: "cancelled_by_operator" }),
    ]);
  });

  it("stands down when the contour was switched off during the wait", async () => {
    const result = await runAutoReplyPipeline(
      INPUT,
      new TestSteps(),
      dependencies({
        loadConversationState: vi.fn(async () => ({ status: "disabled" as const })),
      }),
    );

    expect(result).toEqual({ outcome: "disabled" });
  });

  it("waits again when the customer wrote once more, and answers the last message", async () => {
    // «Новое входящее перезапускает таймер» — на состоянии БД, не на отмене
    // прогона: событие соседнего прогона может не долететь, и ответить обязан
    // этот.
    const steps = new TestSteps();
    const states: ConversationStateSnapshot[] = [
      waiting(),
      waiting({
        latestIncomingId: "in-2",
        latestIncomingText: "Точнее, сколько стоит?",
        latestIncomingAt: "2026-09-07T10:04:00.000Z",
      }),
      waiting({
        latestIncomingId: "in-2",
        latestIncomingText: "Точнее, сколько стоит?",
        latestIncomingAt: "2026-09-07T10:04:00.000Z",
      }),
    ];
    let call = 0;

    const result = await runAutoReplyPipeline(
      INPUT,
      steps,
      dependencies({
        loadConversationState: vi.fn(async () => states[call++]!),
      }),
    );

    expect(result.outcome).toBe("sent");
    expect(steps.sleeps).toEqual([
      { id: "wait-0", until: "2026-09-07T10:05:00.000Z" },
      { id: "wait-1", until: "2026-09-07T10:09:00.000Z" },
    ]);
    expect(journalled[0]).toMatchObject({
      triggerMessageId: "in-1",
      decidedForMessageId: "in-2",
    });
  });

  it("gives up on a customer who never stops writing", async () => {
    // Отвечать на середину серии хуже, чем промолчать: диалог живой и
    // достанется оператору.
    let call = 0;
    const result = await runAutoReplyPipeline(
      INPUT,
      new TestSteps(),
      dependencies({
        loadConversationState: vi.fn(async () => {
          call += 1;
          return waiting({
            latestIncomingId: `in-${call}`,
            latestIncomingAt: "2026-09-07T10:00:00.000Z",
          });
        }),
      }),
    );

    expect(result).toEqual({ outcome: "superseded" });
    expect(call).toBe(MAX_AUTO_REPLY_WAITS + 1);
    expect(journalled).toEqual([
      expect.objectContaining({ outcome: "superseded" }),
    ]);
  });

  it("never calls the model for a message with no text", async () => {
    const deps = dependencies({
      loadConversationState: vi.fn(async () =>
        waiting({ latestIncomingText: "   ", messages: [] }),
      ),
    });

    const result = await runAutoReplyPipeline(INPUT, new TestSteps(), deps);

    expect(result).toEqual({ outcome: "no_text" });
    expect(deps.classify).not.toHaveBeenCalled();
  });

  it("stays silent below the confidence threshold", async () => {
    const deps = dependencies({
      classify: vi.fn(async () => ({
        scenarioIndex: 0,
        confidence: 40,
        language: "ru",
      })),
    });

    const result = await runAutoReplyPipeline(INPUT, new TestSteps(), deps);

    expect(result).toEqual({ outcome: "below_threshold" });
    expect(deps.createReply).not.toHaveBeenCalled();
    expect(journalled).toEqual([
      expect.objectContaining({ outcome: "below_threshold", confidence: 40 }),
    ]);
  });

  it("does not hold the fallback to the confidence threshold", async () => {
    // «Иначе» — не догадка модели, а настройка оператора: придираться к её
    // уверенности не за что.
    const deps = dependencies({
      loadSettings: vi.fn(async () => ({
        isEnabled: true,
        delayMinutes: 5,
        fallbackTemplateId: "tpl-1",
      })),
      classify: vi.fn(async () => ({
        scenarioIndex: null,
        confidence: 10,
        language: "ru",
      })),
    });

    const result = await runAutoReplyPipeline(INPUT, new TestSteps(), deps);

    expect(result.outcome).toBe("sent");
    expect(journalled[0]).toMatchObject({ scenarioId: null, templateId: "tpl-1" });
  });

  it("stays silent when the fallback has no template — the default", async () => {
    const result = await runAutoReplyPipeline(
      INPUT,
      new TestSteps(),
      dependencies({
        classify: vi.fn(async () => ({
          scenarioIndex: null,
          confidence: 90,
          language: "ru",
        })),
      }),
    );

    expect(result).toEqual({ outcome: "no_template" });
  });

  it("stays silent for a scenario set to «не отвечать автоматически»", async () => {
    const deps = dependencies({
      loadScenarios: vi.fn(async () => [
        { ...scenario, action: "ignore" as const, replyTemplateId: null },
      ]),
    });

    const result = await runAutoReplyPipeline(INPUT, new TestSteps(), deps);

    expect(result).toEqual({ outcome: "no_template" });
    expect(deps.loadTemplate).not.toHaveBeenCalled();
  });

  it("tells a deleted template apart from a deliberate silence", async () => {
    const result = await runAutoReplyPipeline(
      INPUT,
      new TestSteps(),
      dependencies({
        loadScenarios: vi.fn(async () => [
          { ...scenario, replyTemplateId: null },
        ]),
      }),
    );

    expect(result).toEqual({ outcome: "template_missing" });
  });

  it("stays silent when the language was not determined", async () => {
    const deps = dependencies({
      classify: vi.fn(async () => ({
        scenarioIndex: 0,
        confidence: 95,
        language: null,
      })),
    });

    const result = await runAutoReplyPipeline(INPUT, new TestSteps(), deps);

    expect(result).toEqual({ outcome: "no_template_language" });
    expect(deps.createReply).not.toHaveBeenCalled();
  });

  it("stays silent when the template has no text in the customer's language", async () => {
    const deps = dependencies({
      classify: vi.fn(async () => ({
        scenarioIndex: 0,
        confidence: 95,
        language: "fr",
      })),
    });

    const result = await runAutoReplyPipeline(INPUT, new TestSteps(), deps);

    expect(result).toEqual({ outcome: "no_template_language" });
    expect(deps.createReply).not.toHaveBeenCalled();
  });

  it("answers in the language the model detected", async () => {
    const deps = dependencies({
      classify: vi.fn(async () => ({
        scenarioIndex: 0,
        confidence: 95,
        language: "de",
      })),
    });

    await runAutoReplyPipeline(INPUT, new TestSteps(), deps);

    expect(deps.createReply).toHaveBeenCalledWith(
      expect.objectContaining({ text: "Versand ist gratis" }),
    );
  });

  it("does not send when the RPC refused under the conversation lock", async () => {
    // Оператор ответил ровно в момент вставки — гонка разрешается в Postgres,
    // а не здесь.
    const deps = dependencies({ createReply: vi.fn(async () => null) });

    const result = await runAutoReplyPipeline(INPUT, new TestSteps(), deps);

    expect(result).toEqual({ outcome: "cancelled_by_operator" });
    expect(deps.requestSend).not.toHaveBeenCalled();
  });
});
