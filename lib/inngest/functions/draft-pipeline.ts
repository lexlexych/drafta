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
  type AiMessage,
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

export type DraftPipelineInput = {
  workspaceId: string;
  conversationId: string;
};

export type DraftPipelineResult =
  | { status: "ready"; draftId: string }
  | { status: "skipped"; reason: "no-incoming" };

export type DraftPipelineSteps = {
  run<T>(id: string, handler: () => Promise<T> | T): Promise<T>;
};

type PromptLogger = {
  info(message: string): void;
};

export type PipelineAiSettings = {
  systemPrompt: string;
  model: string;
};

export type PipelineMessage = {
  id: string;
  direction: "incoming" | "outgoing";
  text: string;
  createdAt: string;
};

export type LoadedDraftContext = {
  workspaceId: string;
  conversationId: string;
  aiSettings: PipelineAiSettings;
  messages: PipelineMessage[];
  batchMessages: PipelineMessage[];
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
  aiSettings: PipelineAiSettings;
  messages: PipelineMessage[];
  batchMessages: PipelineMessage[];
  channelCapabilities: ChannelCapabilities;
  knowledgeBase: KnowledgeBaseContext;
  contactNotes: string;
  entities: MaskedEntity[];
};

export type DraftPipelineDependencies = {
  loadContext(input: DraftPipelineInput): Promise<LoadedDraftContext | null>;
  createGeneratingDraft(input: { context: MaskedDraftContext }): Promise<string>;
  resolveModel(requestedModel: string): string;
  generate(
    prompt: readonly AiMessage[],
    options: {
      model: string;
      maxTokens: number;
      workspaceId: string;
      /** Ties the logged exchange to the draft it produced (`ai_request_log`). */
      draftId: string;
    },
  ): Promise<string>;
  finalizeDraft(input: {
    workspaceId: string;
    draftId: string;
    text: string;
    model: string;
    manualReviewReason: string | null;
    /** Categories the model named; also replaces the conversation's set. */
    matchedKbFileIds: readonly string[];
  }): Promise<void>;
  failGeneratingDrafts(input: {
    workspaceId: string;
    conversationId: string;
  }): Promise<void>;
};

type QueryError = { code?: string } | null;

function assertQuerySucceeded(error: QueryError, operation: string): void {
  if (!error) {
    return;
  }

  const code = error.code ? ` (${error.code})` : "";
  throw new Error(`${operation} failed${code}.`);
}

function normalizeAiSettings(row: Record<string, unknown>): PipelineAiSettings {
  if (typeof row.system_prompt !== "string" || typeof row.model !== "string") {
    throw new Error("Workspace AI settings are invalid.");
  }

  return {
    systemPrompt: row.system_prompt,
    model: row.model,
  };
}

function normalizeMessage(row: Record<string, unknown>): PipelineMessage {
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
  chronologicalMessages: readonly PipelineMessage[],
): PipelineMessage[] {
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
  chronologicalMessages: readonly PipelineMessage[],
): PipelineMessage[] {
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

async function loadContext(
  input: DraftPipelineInput,
): Promise<LoadedDraftContext | null> {
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

async function createGeneratingDraft(input: {
  context: MaskedDraftContext;
}): Promise<string> {
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
    })
    .select("id")
    .single();
  assertQuerySucceeded(error, "Creating a generating draft");

  if (!data?.id) {
    throw new Error("Creating a generating draft returned no identifier.");
  }

  return data.id;
}

async function finalizeDraft(input: {
  workspaceId: string;
  draftId: string;
  text: string;
  model: string;
  manualReviewReason: string | null;
  matchedKbFileIds: readonly string[];
}): Promise<void> {
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

export const draftPipelineDependencies: DraftPipelineDependencies = {
  loadContext,
  createGeneratingDraft,
  resolveModel: resolveGenerationModel,
  generate: async (prompt, options) => {
    try {
      const completion = await generateCompletionWithUsage(prompt, {
        model: options.model,
        maxTokens: options.maxTokens,
        temperature: 0.3,
      });

      // Recorded inside the same Inngest step as the call itself: if the step is
      // retried the provider really was asked twice, so a second row is the
      // truthful accounting, not a duplicate.
      await recordAiUsage({
        workspaceId: options.workspaceId,
        operation: "draft",
        surface: "message",
        provider: completion.provider,
        model: completion.model,
        usage: completion.usage,
      });
      await recordAiRequest({
        workspaceId: options.workspaceId,
        operation: "draft",
        surface: "message",
        provider: completion.provider,
        model: completion.model,
        draftId: options.draftId,
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
          workspaceId: options.workspaceId,
          operation: "draft",
          surface: "message",
          provider: error.provider,
          model: error.model ?? options.model,
          draftId: options.draftId,
          exchange: error.exchange ?? null,
          usage: null,
          errorCode: error.code,
        });
      }

      throw error;
    }
  },
  finalizeDraft,
  failGeneratingDrafts,
};

export async function runDraftPipeline(
  input: DraftPipelineInput,
  steps: DraftPipelineSteps,
  dependencies: DraftPipelineDependencies = draftPipelineDependencies,
  logger?: PromptLogger,
): Promise<DraftPipelineResult> {
  const context = await steps.run("load-context", () =>
    dependencies.loadContext(input),
  );
  if (!context) {
    return { status: "skipped", reason: "no-incoming" };
  }

  const generationModel = dependencies.resolveModel(context.aiSettings.model);
  const maskedContext = await steps.run("mask", () =>
    buildGenerationContext(context),
  );
  const draftId = await steps.run("create-generating", () =>
    dependencies.createGeneratingDraft({ context: maskedContext }),
  );
  const completion = await steps.run("generate", async () => {
    const prompt = buildDraftPrompt({
      aiSettings: maskedContext.aiSettings,
      maskedMessages: maskedContext.messages.map((message) => ({
        direction: message.direction,
        text: message.text,
      })),
      channelCapabilities: maskedContext.channelCapabilities,
      knowledgeBase: maskedContext.knowledgeBase,
      maskedContactNotes: maskedContext.contactNotes || undefined,
    });
    logPromptIfEnabled(prompt, logger ? { logger } : undefined);

    return dependencies.generate(prompt, {
      model: generationModel,
      maxTokens: DEFAULT_DRAFT_MAX_TOKENS,
      workspaceId: input.workspaceId,
      draftId,
    });
  });
  // Unmask first, then parse: a refusal reason may itself mention a masked
  // value, and the marker check is unaffected by placeholder substitution.
  const restoredText = await steps.run("restore", () =>
    unmaskText(completion, maskedContext.entities),
  );
  const parsed = await steps.run("parse-completion", () =>
    parseDraftCompletion(restoredText),
  );
  // Имена категорий модель копирует из фрагментов базы знаний, поэтому
  // разворачиваем их в id по полному списку категорий workspace, а не только по
  // активным: выключенная после генерации категория всё ещё осмысленный ответ.
  const matchedKbFileIds = resolveMatchedCategoryIds(
    context.knowledgeFiles,
    parsed.categoryNames,
  );

  await steps.run("finalize", () =>
    dependencies.finalizeDraft({
      workspaceId: input.workspaceId,
      draftId,
      text: parsed.text,
      model: generationModel,
      manualReviewReason: parsed.manualReviewReason,
      matchedKbFileIds,
    }),
  );

  return { status: "ready", draftId };
}
