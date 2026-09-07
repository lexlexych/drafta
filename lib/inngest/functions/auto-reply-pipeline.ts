import "server-only";

import {
  AiProviderError,
  generateCompletionWithUsage,
  maskMessages,
} from "@/lib/ai";
import {
  buildClassificationPrompt,
  parseClassificationCompletion,
} from "@/lib/ai/classify-prompt";
import { getAutoReplyMinConfidence } from "@/lib/auto-reply/config";
import { pickTemplateBody } from "@/lib/auto-reply/template-selection";
import { createAdminSupabaseClient } from "@/lib/db/admin";
import { recordAiRequest } from "@/lib/db/ai-request-log";
import { recordAiUsage } from "@/lib/db/ai-usage";

/**
 * Автоответ: классификация входящего и отложенная отправка шаблона
 * (docs/architecture/07-data-flows.md#67-автоответ).
 *
 * Чистый пайплайн с инжектируемыми шагами — как `./send-pipeline.ts`: Inngest
 * сюда не импортируется, поэтому весь порядок решений проверяется юнит-тестом
 * без очереди и без сети.
 *
 * Две вещи, ради которых он устроен именно так:
 *
 * 1. **Ожидание идёт перед классификацией.** Оператор чаще всего успевает
 *    ответить сам, а сценарии и шаблоны за эти минуты могли поменяться — значит
 *    и то и другое читается после сна, и вызов модели не тратится впустую.
 * 2. **«Побеждает последнее входящее».** Клиент, дописавший вопрос, запускает
 *    свой прогон; проснувшись, прогон проверяет, осталось ли его сообщение
 *    последним, и если нет — досыпает до дедлайна нового. Досыпает, а не
 *    выходит: событие соседнего прогона эмитится fail-safe и может не долететь,
 *    и тогда ответить обязан этот. Двойную отправку это не создаёт — решение
 *    принимается по одному и тому же «последнему» сообщению, а уникальный
 *    индекс `messages_auto_reply_for_message_id_key` не даёт вставить второе.
 */

/** Сколько раз прогон готов досыпать за дописывающим клиентом. */
export const MAX_AUTO_REPLY_WAITS = 6;

/** Контекст переписки для классификатора: столько последних сообщений. */
export const AUTO_REPLY_CONTEXT_MESSAGE_LIMIT = 10;

export const AUTO_REPLY_MAX_TOKENS = 32;

export type AutoReplyPipelineInput = {
  workspaceId: string;
  conversationId: string;
  messageId: string;
};

/** Исходы совпадают со словарём `auto_reply_runs.outcome`. */
export type AutoReplyOutcome =
  | "sent"
  | "disabled"
  | "no_text"
  | "below_threshold"
  | "no_template"
  | "template_missing"
  | "no_template_language"
  | "cancelled_by_operator"
  | "superseded"
  | "failed";

export type AutoReplyPipelineResult = {
  outcome: AutoReplyOutcome;
  replyMessageId?: string;
};

export type AutoReplySteps = {
  run<T>(id: string, handler: () => Promise<T> | T): Promise<T>;
  sleepUntil(id: string, until: string): Promise<void>;
};

export type AutoReplySettingsSnapshot = {
  isEnabled: boolean;
  delayMinutes: number;
  fallbackTemplateId: string | null;
};

export type AutoReplyScenarioSnapshot = {
  id: string;
  name: string;
  condition: string;
  examples: string[];
  action: "reply" | "ignore";
  replyTemplateId: string | null;
};

export type ConversationStateSnapshot =
  | { status: "operator-replied" }
  | { status: "gone" }
  /** Контур выключили, пока прогон спал. */
  | { status: "disabled" }
  | {
      status: "waiting";
      /** Последнее входящее беседы — то, на которое в итоге отвечаем. */
      latestIncomingId: string;
      /** Его текст (уже без маскирования — маскирует шаг классификации). */
      latestIncomingText: string;
      /** Момент, с которого отсчитывается пауза. */
      latestIncomingAt: string;
      /** Хвост переписки для контекста классификатора, в хронологии. */
      messages: { direction: "incoming" | "outgoing"; text: string }[];
    };

export type ClassificationResult = {
  scenarioIndex: number | null;
  confidence: number | null;
  language: string | null;
};

export type TemplateSnapshot = {
  id: string;
  bodies: Record<string, string>;
};

export type AutoReplyJournalEntry = {
  workspaceId: string;
  conversationId: string;
  triggerMessageId: string;
  decidedForMessageId: string;
  scenarioId: string | null;
  scenarioName: string | null;
  confidence: number | null;
  detectedLanguage: string | null;
  templateId: string | null;
  templateBodyKey: string | null;
  outcome: AutoReplyOutcome;
  replyMessageId: string | null;
};

export type AutoReplyDependencies = {
  loadSettings(workspaceId: string): Promise<AutoReplySettingsSnapshot>;
  loadConversationState(
    input: AutoReplyPipelineInput,
  ): Promise<ConversationStateSnapshot>;
  loadScenarios(workspaceId: string): Promise<AutoReplyScenarioSnapshot[]>;
  classify(input: {
    workspaceId: string;
    messages: { direction: "incoming" | "outgoing"; text: string }[];
    scenarios: AutoReplyScenarioSnapshot[];
  }): Promise<ClassificationResult>;
  loadTemplate(input: {
    workspaceId: string;
    templateId: string;
  }): Promise<TemplateSnapshot | null>;
  createReply(input: {
    workspaceId: string;
    conversationId: string;
    decidedForMessageId: string;
    text: string;
  }): Promise<string | null>;
  requestSend(input: {
    workspaceId: string;
    conversationId: string;
    messageId: string;
  }): Promise<void>;
  journal(entry: AutoReplyJournalEntry): Promise<void>;
  minConfidence(): number;
  random(): number;
};

function deadlineFrom(isoTimestamp: string, delayMinutes: number): string {
  return new Date(
    new Date(isoTimestamp).getTime() + delayMinutes * 60_000,
  ).toISOString();
}

export async function runAutoReplyPipeline(
  input: AutoReplyPipelineInput,
  steps: AutoReplySteps,
  dependencies: AutoReplyDependencies,
): Promise<AutoReplyPipelineResult> {
  const settings = await steps.run("load-settings", () =>
    dependencies.loadSettings(input.workspaceId),
  );

  // Выключенный контур не пишет в журнал: строка на каждое входящее у каждого
  // workspace, где автоответы просто не включали, — это шум, а не диагностика.
  if (!settings.isEnabled) {
    return { outcome: "disabled" };
  }

  let decidedFor = input.messageId;

  const finish = async (
    outcome: AutoReplyOutcome,
    entry: Partial<AutoReplyJournalEntry> = {},
  ): Promise<AutoReplyPipelineResult> => {
    await dependencies.journal({
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      triggerMessageId: input.messageId,
      decidedForMessageId: decidedFor,
      scenarioId: null,
      scenarioName: null,
      confidence: null,
      detectedLanguage: null,
      templateId: null,
      templateBodyKey: null,
      replyMessageId: null,
      ...entry,
      outcome,
    });

    return entry.replyMessageId
      ? { outcome, replyMessageId: entry.replyMessageId }
      : { outcome };
  };

  let state = await steps.run("check-conversation-0", () =>
    dependencies.loadConversationState(input),
  );
  let waits = 0;

  // Ждём тишины: пауза отсчитывается от последнего входящего, и пока клиент
  // дописывает, дедлайн уезжает вместе с ним.
  for (;;) {
    if (state.status === "gone") {
      // Беседу или сообщение удалили — писать в журнал уже некуда: у строки
      // внешние ключи на них обоих.
      return { outcome: "superseded" };
    }
    if (state.status === "disabled") {
      return { outcome: "disabled" };
    }
    if (state.status === "operator-replied") {
      return finish("cancelled_by_operator");
    }

    decidedFor = state.latestIncomingId;

    if (waits >= MAX_AUTO_REPLY_WAITS) {
      // Клиент пишет без остановки. Отвечать на середину серии хуже, чем
      // промолчать: диалог явно живой и достанется оператору.
      return finish("superseded");
    }

    // Ноль минут — «отвечать сразу», и шага сна тогда просто нет: нулевая
    // длительность в Inngest не документирована. Дедлайн в прошлом (прогон
    // стартовал с задержкой) Inngest пропускает сам.
    if (settings.delayMinutes > 0) {
      await steps.sleepUntil(
        `wait-${waits}`,
        deadlineFrom(state.latestIncomingAt, settings.delayMinutes),
      );
    }

    const previousIncomingId = state.latestIncomingId;
    waits += 1;
    state = await steps.run(`check-conversation-${waits}`, () =>
      dependencies.loadConversationState(input),
    );

    if (
      state.status === "waiting" &&
      state.latestIncomingId === previousIncomingId
    ) {
      // Тишина выдержана — отвечаем на это сообщение.
      decidedFor = state.latestIncomingId;
      break;
    }
  }

  if (state.status !== "waiting") {
    return finish("superseded");
  }

  const conversation = state;

  if (conversation.latestIncomingText.trim().length === 0) {
    // Одно вложение без текста: классифицировать нечего, а вызов модели стоит
    // денег.
    return finish("no_text");
  }

  const scenarios = await steps.run("load-scenarios", () =>
    dependencies.loadScenarios(input.workspaceId),
  );

  // Классификация и разворачивание номера обратно в сценарий — один шаг:
  // список читается здесь же, и вынести его наружу значило бы позволить
  // номерам разъехаться с порядком сценариев.
  const classification = await steps.run("classify", () =>
    dependencies.classify({
      workspaceId: input.workspaceId,
      messages: conversation.messages,
      scenarios,
    }),
  );

  const scenario =
    classification.scenarioIndex === null
      ? null
      : (scenarios[classification.scenarioIndex] ?? null);

  const journalBase = {
    scenarioId: scenario?.id ?? null,
    scenarioName: scenario?.name ?? null,
    confidence: classification.confidence,
    detectedLanguage: classification.language,
  };

  // Порог применяется только к выбранному сценарию: «иначе» — это не догадка
  // модели, а настройка оператора, и придираться к её уверенности не за что.
  if (
    scenario !== null &&
    (classification.confidence ?? 0) < dependencies.minConfidence()
  ) {
    return finish("below_threshold", journalBase);
  }

  if (scenario?.action === "ignore") {
    return finish("no_template", journalBase);
  }

  const templateId = scenario
    ? scenario.replyTemplateId
    : settings.fallbackTemplateId;

  if (!templateId) {
    // У «иначе» шаблона нет по умолчанию — это молчание по замыслу. У сценария
    // с action = reply пустая ссылка означает удалённый шаблон, то есть
    // сломанную настройку; журнал их различает.
    return finish(scenario ? "template_missing" : "no_template", journalBase);
  }

  const template = await steps.run("load-template", () =>
    dependencies.loadTemplate({ workspaceId: input.workspaceId, templateId }),
  );

  if (!template) {
    return finish("template_missing", { ...journalBase, templateId });
  }

  const body = pickTemplateBody(
    template.bodies,
    classification.language,
    dependencies.random,
  );

  if (!body) {
    // Язык не определён или у шаблона нет текста на нём — требование фичи:
    // не отправлять ничего.
    return finish("no_template_language", { ...journalBase, templateId });
  }

  const replyMessageId = await steps.run("create-reply", () =>
    dependencies.createReply({
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      decidedForMessageId: conversation.latestIncomingId,
      text: body.text,
    }),
  );

  if (!replyMessageId) {
    // RPC отказала под блокировкой беседы: оператор успел ответить или клиент
    // дописал уже после решения.
    return finish("cancelled_by_operator", {
      ...journalBase,
      templateId,
      templateBodyKey: body.key,
    });
  }

  // Отправку ведёт существующая `send-message` с ретраями (правило 8). Шаг
  // отдельный, поэтому повтор `create-reply` не порождает второй отправки, а
  // повтор эмита безопасен: пайплайн отправки идемпотентен по `external_id`.
  await steps.run("request-send", () =>
    dependencies.requestSend({
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      messageId: replyMessageId,
    }),
  );

  return finish("sent", {
    ...journalBase,
    templateId,
    templateBodyKey: body.key,
    replyMessageId,
  });
}

/* -------------------------------------------------------------------------
 * Реальные зависимости: Supabase под service_role и провайдер LLM
 * ---------------------------------------------------------------------- */

type QueryError = { code?: string } | null;

function assertQuerySucceeded(error: QueryError, operation: string): void {
  if (!error) {
    return;
  }

  const code = error.code ? ` (${error.code})` : "";
  throw new Error(`${operation} failed${code}.`);
}

async function loadSettings(
  workspaceId: string,
): Promise<AutoReplySettingsSnapshot> {
  const supabase = createAdminSupabaseClient();
  const { data, error } = await supabase
    .from("auto_reply_settings")
    .select("is_enabled, delay_minutes, fallback_template_id")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  assertQuerySucceeded(error, "Loading auto-reply settings");

  if (!data) {
    // Строки нет — контур не включали ни разу.
    return { isEnabled: false, delayMinutes: 0, fallbackTemplateId: null };
  }

  return {
    isEnabled: data.is_enabled === true,
    delayMinutes: Number(data.delay_minutes ?? 0),
    fallbackTemplateId: (data.fallback_template_id as string | null) ?? null,
  };
}

/**
 * Состояние беседы на момент пробуждения — один запрос на хвост переписки.
 *
 * Порядок «последнего сообщения» здесь тот же, что у превью треда и у RPC:
 * `created_at desc, id desc`. Совпадение не косметическое — по нему прогон
 * решает, дозрела ли пауза, а RPC под блокировкой проверяет то же самое.
 */
async function loadConversationState(
  input: AutoReplyPipelineInput,
): Promise<ConversationStateSnapshot> {
  const supabase = createAdminSupabaseClient();

  const settings = await loadSettings(input.workspaceId);

  if (!settings.isEnabled) {
    return { status: "disabled" };
  }

  const { data, error } = await supabase
    .from("messages")
    .select("id, direction, text, created_at")
    .eq("workspace_id", input.workspaceId)
    .eq("conversation_id", input.conversationId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(AUTO_REPLY_CONTEXT_MESSAGE_LIMIT);
  assertQuerySucceeded(error, "Loading the conversation tail");

  const rows = (data ?? []) as {
    id: string;
    direction: "incoming" | "outgoing";
    text: string | null;
    created_at: string;
  }[];

  if (rows.length === 0) {
    return { status: "gone" };
  }

  const latestIncomingIndex = rows.findIndex(
    (row) => row.direction === "incoming",
  );

  if (latestIncomingIndex === -1) {
    return { status: "gone" };
  }

  // Исходящее новее последнего входящего — оператор (или прошлый автоответ)
  // уже ответил. Проверка по самим сообщениям, а не по своему флагу: ответ,
  // отправленный из приложения провайдера, приезжает вебхуком `message.sent` и
  // тоже обязан отменять автоответ.
  if (latestIncomingIndex > 0) {
    return { status: "operator-replied" };
  }

  const latest = rows[0]!;

  return {
    status: "waiting",
    latestIncomingId: latest.id,
    latestIncomingText: latest.text ?? "",
    latestIncomingAt: latest.created_at,
    messages: rows
      .slice()
      .reverse()
      .map((row) => ({ direction: row.direction, text: row.text ?? "" })),
  };
}

async function loadScenarios(
  workspaceId: string,
): Promise<AutoReplyScenarioSnapshot[]> {
  const supabase = createAdminSupabaseClient();
  const { data, error } = await supabase
    .from("auto_reply_scenarios")
    .select("id, name, condition, examples, action, reply_template_id")
    .eq("workspace_id", workspaceId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  assertQuerySucceeded(error, "Loading auto-reply scenarios");

  return (data ?? []).map((row) => ({
    id: row.id as string,
    name: row.name as string,
    condition: (row.condition as string | null) ?? "",
    examples: Array.isArray(row.examples) ? (row.examples as string[]) : [],
    action: row.action === "ignore" ? "ignore" : "reply",
    replyTemplateId: (row.reply_template_id as string | null) ?? null,
  }));
}

/**
 * Один вызов модели: классификация входящего по сценариям.
 *
 * Модель — провайдерский дефолт, а не выбранная в «Настройки → AI»: та выбрана
 * под генерацию черновиков, а классификация дешевле и механичнее (та же логика,
 * что у перевода — docs/architecture/08-ai-subsystem.md#перевод-сообщения).
 *
 * Маскирование обязательно (правило 9) и делается одним вызовом на весь набор
 * строк, чтобы нумерация плейсхолдеров была сквозной. Обратная подстановка не
 * нужна: наружу из этого вызова уходят только номер, число и код языка.
 */
async function classify(input: {
  workspaceId: string;
  messages: { direction: "incoming" | "outgoing"; text: string }[];
  scenarios: AutoReplyScenarioSnapshot[];
}): Promise<ClassificationResult> {
  const values = [
    ...input.messages.map((message) => message.text),
    ...input.scenarios.flatMap((scenario) => [
      scenario.condition,
      ...scenario.examples,
    ]),
  ];
  const { masked } = maskMessages(values);

  let cursor = input.messages.length;
  const maskedMessages = input.messages.map((message, index) => ({
    direction: message.direction,
    text: masked[index] ?? message.text,
  }));
  const maskedScenarios = input.scenarios.map((scenario) => {
    const condition = masked[cursor] ?? scenario.condition;
    cursor += 1;
    const examples = scenario.examples.map(() => {
      const example = masked[cursor] ?? "";
      cursor += 1;
      return example;
    });

    return { name: scenario.name, condition, examples };
  });

  const prompt = buildClassificationPrompt({
    maskedMessages,
    scenarios: maskedScenarios,
  });

  try {
    const completion = await generateCompletionWithUsage(prompt, {
      // Классификация должна быть воспроизводимой: один и тот же вопрос
      // клиента не может попадать то в один сценарий, то в другой.
      temperature: 0,
      maxTokens: AUTO_REPLY_MAX_TOKENS,
    });

    // Внутри того же шага, что и вызов: при ретрае провайдера действительно
    // спросили дважды, и вторая строка — честный учёт, а не дубль.
    await recordAiUsage({
      workspaceId: input.workspaceId,
      operation: "auto_reply",
      surface: "message",
      provider: completion.provider,
      model: completion.model,
      usage: completion.usage,
    });
    await recordAiRequest({
      workspaceId: input.workspaceId,
      operation: "auto_reply",
      surface: "message",
      provider: completion.provider,
      model: completion.model,
      exchange: completion.exchange,
      usage: completion.usage,
    });

    return parseClassificationCompletion(completion.text, input.scenarios.length);
  } catch (error) {
    if (error instanceof AiProviderError) {
      await recordAiRequest({
        workspaceId: input.workspaceId,
        operation: "auto_reply",
        surface: "message",
        provider: error.provider,
        // Модель не выбирается настройками — её называет сам провайдер, и в
        // ошибке она есть не всегда.
        model: error.model ?? "unknown",
        exchange: error.exchange ?? null,
        usage: null,
        errorCode: error.code,
      });
    }

    throw error;
  }
}

async function loadTemplate(input: {
  workspaceId: string;
  templateId: string;
}): Promise<TemplateSnapshot | null> {
  const supabase = createAdminSupabaseClient();
  // Без фильтра по поверхности: сценарий ссылается на шаблон явно, и снятая
  // позже галочка «предлагать в поле ответа» не должна тихо ломать автоответ.
  const { data, error } = await supabase
    .from("reply_templates")
    .select("id, bodies")
    .eq("workspace_id", input.workspaceId)
    .eq("id", input.templateId)
    .maybeSingle();
  assertQuerySucceeded(error, "Loading the auto-reply template");

  if (!data) {
    return null;
  }

  return {
    id: data.id as string,
    bodies: (data.bodies ?? {}) as Record<string, string>,
  };
}

async function createReply(input: {
  workspaceId: string;
  conversationId: string;
  decidedForMessageId: string;
  text: string;
}): Promise<string | null> {
  const supabase = createAdminSupabaseClient();
  const { data, error } = await supabase.rpc("create_auto_reply_message", {
    target_workspace_id: input.workspaceId,
    target_conversation_id: input.conversationId,
    decided_for_message_id: input.decidedForMessageId,
    reply_text: input.text,
  });
  assertQuerySucceeded(error, "Creating the auto reply");

  return typeof data === "string" && data.length > 0 ? data : null;
}

async function journal(entry: AutoReplyJournalEntry): Promise<void> {
  const supabase = createAdminSupabaseClient();
  const { error } = await supabase.from("auto_reply_runs").insert({
    workspace_id: entry.workspaceId,
    conversation_id: entry.conversationId,
    trigger_message_id: entry.triggerMessageId,
    decided_for_message_id: entry.decidedForMessageId,
    scenario_id: entry.scenarioId,
    scenario_name: entry.scenarioName,
    confidence: entry.confidence,
    detected_language: entry.detectedLanguage,
    template_id: entry.templateId,
    template_body_key: entry.templateBodyKey,
    outcome: entry.outcome,
    reply_message_id: entry.replyMessageId,
  });

  if (error) {
    // Журнал — диагностика, а не отправка: упавшая запись не должна ронять
    // прогон, который клиенту уже ответил.
    console.error("[auto-reply] failed to write the decision journal", error);
  }
}

export const autoReplyDependencies: AutoReplyDependencies = {
  loadSettings,
  loadConversationState,
  loadScenarios,
  classify,
  loadTemplate,
  createReply,
  requestSend: async (input) => {
    const { emitMessageSendRequested } = await import("../events");
    await emitMessageSendRequested({
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      messageId: input.messageId,
    });
  },
  journal,
  minConfidence: () => getAutoReplyMinConfidence(),
  random: () => Math.random(),
};

/**
 * Пишет в журнал провалившийся прогон — зовётся из `onFailure`, когда ретраи
 * исчерпаны. Само сообщение при этом не создано (или создано и ушло в отправку
 * со своими ретраями), так что чинить тут нечего: строка нужна, чтобы «клиенту
 * не ответили» имело причину.
 */
export async function journalFailedAutoReply(input: {
  workspaceId: string;
  conversationId: string;
  messageId: string;
}): Promise<void> {
  await journal({
    workspaceId: input.workspaceId,
    conversationId: input.conversationId,
    triggerMessageId: input.messageId,
    decidedForMessageId: input.messageId,
    scenarioId: null,
    scenarioName: null,
    confidence: null,
    detectedLanguage: null,
    templateId: null,
    templateBodyKey: null,
    outcome: "failed",
    replyMessageId: null,
  });
}
