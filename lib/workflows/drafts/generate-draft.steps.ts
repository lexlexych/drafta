import "server-only";

import {
  AiProviderError,
  buildDraftPrompt,
  generateCompletionWithUsage,
  logPromptIfEnabled,
  maskMessages,
  parseDraftCompletion,
  resolveGenerationModel,
  unmaskText,
  type MaskedEntity,
} from "@/lib/ai";
import {
  buildKnowledgeBaseContext,
  type KnowledgeBaseContext,
  type KnowledgeFileForPrompt,
} from "@/lib/ai/knowledge-base";
import {
  resolveChannelCapabilities,
  type ChannelCapabilities,
} from "@/lib/channels/capabilities";
import { createAdminSupabaseClient } from "@/lib/db/admin";
import { recordAiRequest } from "@/lib/db/ai-request-log";
import { recordAiUsage } from "@/lib/db/ai-usage";
import {
  listKnowledgeFiles,
  type KnowledgeFileRow,
} from "@/lib/db/knowledge-base";

export const DRAFT_CONTEXT_MESSAGE_LIMIT = 20;
export const DEFAULT_DRAFT_MAX_TOKENS = 800;

export type GenerateDraftInput = {
  workspaceId: string;
  conversationId: string;
};

export type GenerateDraftResult =
  | { status: "ready"; draftId: string }
  | { status: "skipped"; reason: "no-incoming" };

export type DraftAiSettings = {
  systemPrompt: string;
  model: string;
};

export type DraftMessage = {
  id: string;
  direction: "incoming" | "outgoing";
  text: string;
  createdAt: string;
};

export type LoadedDraftContext = {
  workspaceId: string;
  conversationId: string;
  aiSettings: DraftAiSettings;
  messages: DraftMessage[];
  batchMessages: DraftMessage[];
  channelCapabilities: ChannelCapabilities;
  /**
   * Categories of the workspace knowledge base, raw. The prompt fragment keeps
   * the active ones; the full list also resolves the names the model returns
   * back to `kb_files` ids.
   */
  knowledgeFiles: KnowledgeFileForPrompt[];
  /** The contact's notes (docs/architecture/16-rollout-plan.md, этап 7). */
  contactNotes: string;
};

/** Everything the generation call needs, already masked. */
type MaskedDraftContext = {
  workspaceId: string;
  conversationId: string;
  aiSettings: DraftAiSettings;
  messages: DraftMessage[];
  batchMessages: DraftMessage[];
  channelCapabilities: ChannelCapabilities;
  knowledgeBase: KnowledgeBaseContext;
  contactNotes: string;
  entities: MaskedEntity[];
};

type QueryError = { code?: string } | null;

function assertQuerySucceeded(error: QueryError, operation: string): void {
  if (!error) {
    return;
  }

  const code = error.code ? ` (${error.code})` : "";
  throw new Error(`${operation} failed${code}.`);
}

function normalizeAiSettings(row: Record<string, unknown>): DraftAiSettings {
  if (typeof row.system_prompt !== "string" || typeof row.model !== "string") {
    throw new Error("Workspace AI settings are invalid.");
  }

  return {
    systemPrompt: row.system_prompt,
    model: row.model,
  };
}

function normalizeMessage(row: Record<string, unknown>): DraftMessage {
  if (
    typeof row.id !== "string" ||
    (row.direction !== "incoming" && row.direction !== "outgoing") ||
    typeof row.text !== "string" ||
    typeof row.created_at !== "string"
  ) {
    throw new Error("Conversation message data is invalid.");
  }

  return {
    id: row.id,
    direction: row.direction,
    text: row.text,
    createdAt: row.created_at,
  };
}

export function selectBatchMessages(
  chronologicalMessages: readonly DraftMessage[],
): DraftMessage[] {
  let lastOutgoingIndex = -1;
  chronologicalMessages.forEach((message, index) => {
    if (message.direction === "outgoing") {
      lastOutgoingIndex = index;
    }
  });

  return chronologicalMessages
    .slice(lastOutgoingIndex + 1)
    .filter((message) => message.direction === "incoming");
}

/**
 * The messages the draft is an answer *to*, and therefore what
 * `first_message_id`/`last_message_id` point at.
 *
 * Normally that is the un-replied batch — everything incoming after our last
 * outgoing message. Generation is user-initiated now, though, so the button
 * also gets pressed in threads where we already answered last; there the draft
 * is anchored to the most recent incoming message instead of refusing to run.
 * Either way the prompt itself sees the last `DRAFT_CONTEXT_MESSAGE_LIMIT`
 * messages, so the anchor only decides what the draft row is attached to.
 */
export function selectAnchorMessages(
  chronologicalMessages: readonly DraftMessage[],
): DraftMessage[] {
  const batch = selectBatchMessages(chronologicalMessages);
  if (batch.length > 0) {
    return batch;
  }

  const lastIncoming = [...chronologicalMessages]
    .reverse()
    .find((message) => message.direction === "incoming");

  return lastIncoming ? [lastIncoming] : [];
}

/**
 * Resolves the category names the model returned back to `kb_files` ids.
 *
 * The model never sees ids — it copies the names out of the knowledge-base
 * fragments — so this is the only place the two meet. Matching is
 * case-insensitive because a model that title-cases a name still means that
 * category, and names are unique per workspace under `lower(name)` anyway
 * (`kb_files_workspace_lower_name_idx`). A name that matches nothing is
 * dropped: an invented category is not a reason to fail a finished draft.
 */
export function resolveMatchedCategoryIds(
  files: readonly KnowledgeFileForPrompt[],
  categoryNames: readonly string[],
): string[] {
  const idByName = new Map(
    files.map((file) => [file.name.trim().toLocaleLowerCase("ru-RU"), file.id]),
  );

  const ids = categoryNames
    .map((name) => idByName.get(name.trim().toLocaleLowerCase("ru-RU")))
    .filter((id): id is string => Boolean(id));

  return [...new Set(ids)];
}

export async function loadDraftContext(
  input: GenerateDraftInput,
): Promise<LoadedDraftContext | null> {
  "use step";

  const supabase = createAdminSupabaseClient();
  const { data: conversation, error: conversationError } = await supabase
    .from("conversations")
    .select("id, workspace_id, channel_connection_id, contact_id")
    .eq("workspace_id", input.workspaceId)
    .eq("id", input.conversationId)
    .maybeSingle();
  assertQuerySucceeded(conversationError, "Loading draft conversation");

  if (!conversation) {
    return null;
  }

  const [
    { data: settings, error: settingsError },
    { data: connection, error: connectionError },
    { data: messageRows, error: messagesError },
    { data: contactRow, error: contactError },
    knowledgeFiles,
  ] = await Promise.all([
    supabase
      .from("ai_settings")
      .select("system_prompt, model")
      .eq("workspace_id", input.workspaceId)
      .maybeSingle(),
    supabase
      .from("channel_connections")
      .select("id, platform, capabilities")
      .eq("workspace_id", input.workspaceId)
      .eq("id", conversation.channel_connection_id)
      .maybeSingle(),
    supabase
      .from("messages")
      .select("id, direction, text, created_at")
      .eq("workspace_id", input.workspaceId)
      .eq("conversation_id", input.conversationId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(DRAFT_CONTEXT_MESSAGE_LIMIT),
    // Contact notes feed the prompt (docs/architecture/16-rollout-plan.md, этап 7).
    conversation.contact_id
      ? supabase
          .from("contacts")
          .select("notes")
          .eq("workspace_id", input.workspaceId)
          .eq("id", conversation.contact_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    // Reuse the existing workspace-scoped knowledge base helper; there is no
    // parallel model or storage for the generation pipeline.
    listKnowledgeFiles(supabase, input.workspaceId),
  ]);

  assertQuerySucceeded(settingsError, "Loading AI settings");
  assertQuerySucceeded(connectionError, "Loading channel capabilities");
  assertQuerySucceeded(messagesError, "Loading conversation messages");
  assertQuerySucceeded(contactError, "Loading contact notes");

  if (!settings) {
    throw new Error("Workspace AI settings are unavailable.");
  }
  if (!connection) {
    throw new Error("Conversation channel connection is unavailable.");
  }

  const messages = ((messageRows ?? []) as Record<string, unknown>[])
    .map(normalizeMessage)
    .reverse();

  // A DM draft answers the un-replied batch
  // (docs/architecture/07-data-flows.md#62-генерация-черновика). With nothing
  // incoming at all there is nothing to answer, and the action refuses before
  // the event is ever emitted — this is the pipeline's own guard.
  const batchMessages = selectAnchorMessages(messages);
  if (batchMessages.length === 0) {
    return null;
  }

  return {
    workspaceId: input.workspaceId,
    conversationId: input.conversationId,
    aiSettings: normalizeAiSettings(settings as Record<string, unknown>),
    messages,
    batchMessages,
    channelCapabilities: resolveChannelCapabilities(
      connection.platform,
      connection.capabilities,
    ),
    knowledgeFiles: knowledgeFiles satisfies KnowledgeFileRow[],
    contactNotes:
      contactRow && typeof contactRow.notes === "string" ? contactRow.notes : "",
  };
}

/**
 * Builds the knowledge base fragment and masks everything the generation call
 * will see, in one pass so the placeholder map returned here is the one that
 * unmasks the completion.
 */
export function buildGenerationContext(
  context: LoadedDraftContext,
): MaskedDraftContext {
  const knowledgeBase = buildKnowledgeBaseContext(context.knowledgeFiles);
  const values = [
    ...context.messages.map((message) => message.text),
    knowledgeBase.text,
    // Промпт маскируется вместе с остальным: пользователь мог вписать в него
    // телефон или email подписи, а `unmaskText` вернёт их в готовый черновик.
    context.aiSettings.systemPrompt,
    context.contactNotes,
  ];
  const { masked, entities } = maskMessages(values);
  let index = 0;
  const messages = context.messages.map((message) => ({
    ...message,
    text: masked[index++]!,
  }));
  const batchIds = new Set(context.batchMessages.map((message) => message.id));
  const batchMessages = messages.filter((message) => batchIds.has(message.id));
  const knowledgeBaseText = masked[index++]!;
  const systemPrompt = masked[index++]!;
  const contactNotes = masked[index++]!;

  return {
    workspaceId: context.workspaceId,
    conversationId: context.conversationId,
    messages,
    batchMessages,
    contactNotes,
    channelCapabilities: context.channelCapabilities,
    aiSettings: { ...context.aiSettings, systemPrompt },
    knowledgeBase: { ...knowledgeBase, text: knowledgeBaseText },
    entities,
  };
}

export async function createGeneratingDraft(input: {
  context: MaskedDraftContext;
  workflowRunId: string;
}): Promise<string> {
  "use step";

  const firstMessage = input.context.batchMessages[0];
  const lastMessage = input.context.batchMessages.at(-1);
  if (!firstMessage || !lastMessage) {
    throw new Error("Cannot create a draft for an empty message batch.");
  }

  const supabase = createAdminSupabaseClient();
  const { data, error } = await supabase
    .from("drafts")
    .insert({
      workspace_id: input.context.workspaceId,
      conversation_id: input.context.conversationId,
      first_message_id: firstMessage.id,
      last_message_id: lastMessage.id,
      status: "generating",
      kb_file_ids: input.context.knowledgeBase.usedFileIds,
      // Адрес для кнопки «стоп»: по нему действие отмены зовёт run.cancel().
      workflow_run_id: input.workflowRunId,
    })
    .select("id")
    .single();
  assertQuerySucceeded(error, "Creating a generating draft");

  if (!data?.id) {
    throw new Error("Creating a generating draft returned no identifier.");
  }

  return data.id;
}

export async function finalizeDraft(input: {
  workspaceId: string;
  draftId: string;
  text: string;
  model: string;
  manualReviewReason: string | null;
  matchedKbFileIds: readonly string[];
}): Promise<void> {
  "use step";

  const supabase = createAdminSupabaseClient();
  const { data, error } = await supabase.rpc("finalize_draft_generation", {
    target_workspace_id: input.workspaceId,
    target_draft_id: input.draftId,
    generated_text: input.text,
    generated_model: input.model,
    // Генерация всегда явная — оператор нажал значок и ждёт именно этот
    // черновик, поэтому предыдущий (в том числе отредактированный) вытесняется.
    supersede_edited: true,
    review_reason: input.manualReviewReason,
    // Категории беседы всегда от последнего черновика: RPC перезаписывает набор
    // целиком под той же блокировкой, что и сам черновик.
    matched_kb_file_ids: [...input.matchedKbFileIds],
  });
  assertQuerySucceeded(error, "Finalizing a generated draft");

  if (data !== true) {
    throw new Error("The generating draft is no longer available to finalize.");
  }
}

/**
 * Terminal state for a run that gave up (`onFailure`).
 *
 * An UPDATE rather than a DELETE on purpose: the composer learns that its
 * spinner is over through the `drafts` realtime subscription, and that
 * subscription can only carry INSERT/UPDATE — a DELETE payload has no
 * `workspace_id` for the channel filter to match on.
 */
export async function failGeneratingDrafts(input: {
  workspaceId: string;
  conversationId: string;
}): Promise<void> {
  const supabase = createAdminSupabaseClient();
  const { error } = await supabase
    .from("drafts")
    .update({ status: "failed", updated_at: new Date().toISOString() })
    .eq("workspace_id", input.workspaceId)
    .eq("conversation_id", input.conversationId)
    .eq("status", "generating");

  assertQuerySucceeded(error, "Failing generating drafts");
}

/**
 * Вызов модели. Учёт и лог пишутся внутри того же шага, что и сам вызов: если
 * шаг ретраится, провайдера правда спросили дважды, и вторая строка — честный
 * учёт, а не дубль (docs/architecture/08-ai-subsystem.md).
 *
 * `logPromptIfEnabled` зовётся без явного логгера: по умолчанию он пишет в
 * `console`, доступный в шаге, — логгер, приходивший раньше из Inngest, не нужен.
 */
export async function generateDraftCompletion(input: {
  maskedContext: MaskedDraftContext;
  model: string;
  draftId: string;
  workspaceId: string;
}): Promise<string> {
  "use step";

  const prompt = buildDraftPrompt({
    aiSettings: input.maskedContext.aiSettings,
    maskedMessages: input.maskedContext.messages.map((message) => ({
      direction: message.direction,
      text: message.text,
    })),
    channelCapabilities: input.maskedContext.channelCapabilities,
    knowledgeBase: input.maskedContext.knowledgeBase,
    maskedContactNotes: input.maskedContext.contactNotes || undefined,
  });
  logPromptIfEnabled(prompt);

  try {
    const completion = await generateCompletionWithUsage(prompt, {
      model: input.model,
      maxTokens: DEFAULT_DRAFT_MAX_TOKENS,
      temperature: 0.3,
    });

    await recordAiUsage({
      workspaceId: input.workspaceId,
      operation: "draft",
      surface: "message",
      provider: completion.provider,
      model: completion.model,
      usage: completion.usage,
    });
    await recordAiRequest({
      workspaceId: input.workspaceId,
      operation: "draft",
      surface: "message",
      provider: completion.provider,
      model: completion.model,
      draftId: input.draftId,
      exchange: completion.exchange,
      usage: completion.usage,
    });

    return completion.text;
  } catch (error) {
    // A failed call is the one most worth reading back: the provider's error
    // body lives only in the exchange, since AiProviderError deliberately
    // drops the upstream message.
    if (error instanceof AiProviderError) {
      await recordAiRequest({
        workspaceId: input.workspaceId,
        operation: "draft",
        surface: "message",
        provider: error.provider,
        model: error.model ?? input.model,
        draftId: input.draftId,
        exchange: error.exchange ?? null,
        usage: null,
        errorCode: error.code,
      });
    }

    throw error;
  }
}

/** Маскирование + сборка контекста одним шагом: чистая функция, но её результат
 * нужен и следующему шагу, поэтому он проходит через границу шага. */
export async function maskDraftContext(
  context: LoadedDraftContext,
): Promise<MaskedDraftContext> {
  "use step";

  return buildGenerationContext(context);
}

/** Размаскирование и разбор ответа модели. Обе операции чистые. */
export async function restoreAndParseCompletion(input: {
  completion: string;
  maskedContext: MaskedDraftContext;
}): Promise<ReturnType<typeof parseDraftCompletion>> {
  "use step";

  // Сначала размаскируем, потом разбираем: причина отказа сама может упоминать
  // замаскированное значение, а проверка маркера от подстановки не страдает.
  const restored = unmaskText(input.completion, input.maskedContext.entities);
  return parseDraftCompletion(restored);
}

/** Шаг-обёртка над компенсацией: откат такой же durable, как и работа. */
export async function failGeneratingDraftsStep(input: {
  workspaceId: string;
  conversationId: string;
}): Promise<void> {
  "use step";

  await failGeneratingDrafts(input);
}

export { resolveGenerationModel };
