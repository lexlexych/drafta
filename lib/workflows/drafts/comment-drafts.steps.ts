import "server-only";

import {
  AiProviderError,
  buildCommentDraftPrompt,
  generateCompletionWithUsage,
  logPromptIfEnabled,
  maskMessages,
  resolveGenerationModel,
  unmaskText,
} from "@/lib/ai";
import {
  buildKnowledgeBaseContext,
  type KnowledgeBaseContext,
} from "@/lib/ai/knowledge-base";
import {
  getDefaultChannelCapabilities,
  type ChannelCapabilities,
} from "@/lib/channels/capabilities";
import type { ChannelPlatform } from "@/lib/channels/types";
import { createAdminSupabaseClient } from "@/lib/db/admin";
import { recordAiRequest } from "@/lib/db/ai-request-log";
import { recordAiUsage } from "@/lib/db/ai-usage";
import {
  listKnowledgeFiles,
  type KnowledgeFileRow,
} from "@/lib/db/knowledge-base";

/**
 * Generation of comment drafts (docs/architecture/07-data-flows.md).
 *
 * Nothing here is triggered by an incoming comment: a comment draft exists only
 * because the user asked for one — either by confirming the «Черновики» dialog
 * for the whole post, or by pressing «Создать черновик» / the regenerate button
 * on a single comment. That is the whole reason this pipeline is separate from
 * `./draft-pipeline.ts`: no debounce, no batching, no categories, and one draft
 * per comment rather than one per conversation.
 *
 * Comments of one post are generated **sequentially**, each prompt receiving the
 * replies drafted so far, so a post full of near-identical compliments does not
 * come back with fifteen copies of the same sentence.
 */

export const DEFAULT_COMMENT_DRAFT_MAX_TOKENS = 400;

export type CommentDraftsInput = {
  workspaceId: string;
  postId: string;
  /** Narrows the run to one comment; omitted, every comment still needing a draft is covered. */
  commentId?: string;
};

export type CommentDraftsResult =
  | { status: "done"; generated: number }
  | {
      status: "skipped";
      reason: "post-not-found" | "channel-unavailable" | "no-target-comments";
    };

export type CommentDraftsAiSettings = {
  commentSystemPrompt: string;
  model: string;
};

/** One comment the run has to answer, with the thread context it needs. */
export type CommentDraftTarget = {
  commentId: string;
  authorName: string;
  text: string;
  /** The comment this one replies to, when it is a reply-to-a-reply. */
  parent?: { authorName: string; text: string };
};

export type LoadedCommentDraftsContext = {
  workspaceId: string;
  postId: string;
  postText: string;
  brief: { description: string; instruction: string };
  aiSettings: CommentDraftsAiSettings;
  channelCapabilities: ChannelCapabilities;
  knowledgeBase: KnowledgeBaseContext;
  targets: CommentDraftTarget[];
  /** Replies already drafted for other comments of this post. */
  existingDraftTexts: string[];
};

type QueryError = { code?: string } | null;

function assertQuerySucceeded(error: QueryError, operation: string): void {
  if (!error) {
    return;
  }

  const code = error.code ? ` (${error.code})` : "";
  throw new Error(`${operation} failed${code}.`);
}

function isChannelPlatform(value: unknown): value is ChannelPlatform {
  return (
    value === "telegram" ||
    value === "whatsapp" ||
    value === "instagram" ||
    value === "facebook"
  );
}

function channelCapabilities(
  platformValue: unknown,
  storedValue: unknown,
): ChannelCapabilities {
  if (!isChannelPlatform(platformValue)) {
    throw new Error("Post channel platform is unsupported.");
  }

  const defaults = getDefaultChannelCapabilities(platformValue);
  if (typeof storedValue !== "object" || storedValue === null) {
    return defaults;
  }

  const stored = storedValue as Partial<ChannelCapabilities>;
  return {
    ...defaults,
    ...(typeof stored.supportsAttachments === "boolean"
      ? { supportsAttachments: stored.supportsAttachments }
      : {}),
    ...(stored.maxMessageLength === null ||
    typeof stored.maxMessageLength === "number"
      ? { maxMessageLength: stored.maxMessageLength }
      : {}),
    ...(typeof stored.supportsComments === "boolean"
      ? { supportsComments: stored.supportsComments }
      : {}),
  };
}

function normalizeAiSettings(
  row: Record<string, unknown>,
): CommentDraftsAiSettings {
  if (
    typeof row.comment_system_prompt !== "string" ||
    typeof row.model !== "string"
  ) {
    throw new Error("Workspace AI settings are invalid.");
  }

  return {
    commentSystemPrompt: row.comment_system_prompt,
    model: row.model,
  };
}

type CommentRow = {
  id: string;
  contact_identity_id: string | null;
  external_id: string | null;
  parent_external_id: string | null;
  direction: "incoming" | "outgoing";
  text: string;
  created_at: string;
};

/**
 * Which comments this run answers. A whole-post run deliberately leaves alone
 * anything the user has already dealt with — comments that were replied to, and
 * comments that already carry a live draft (which may have been edited by hand).
 * A single-comment run always regenerates: that is what its button means.
 */
export function selectTargetComments(
  comments: readonly CommentRow[],
  commentsWithActiveDraft: ReadonlySet<string>,
  requestedCommentId: string | undefined,
): CommentRow[] {
  const answeredExternalIds = new Set(
    comments
      .filter((comment) => comment.direction === "outgoing" && comment.parent_external_id)
      .map((comment) => comment.parent_external_id!),
  );

  const isAnswered = (comment: CommentRow) =>
    comment.external_id !== null && answeredExternalIds.has(comment.external_id);

  if (requestedCommentId) {
    const target = comments.find(
      (comment) =>
        comment.id === requestedCommentId && comment.direction === "incoming",
    );
    return target && !isAnswered(target) ? [target] : [];
  }

  return comments.filter(
    (comment) =>
      comment.direction === "incoming" &&
      !isAnswered(comment) &&
      !commentsWithActiveDraft.has(comment.id),
  );
}

export async function loadCommentDraftsContext(
  input: CommentDraftsInput,
): Promise<LoadedCommentDraftsContext | { skip: CommentDraftsResult }> {
  "use step";

  const supabase = createAdminSupabaseClient();

  const { data: post, error: postError } = await supabase
    .from("posts")
    .select(
      "id, channel_connection_id, text, draft_description, draft_instruction",
    )
    .eq("workspace_id", input.workspaceId)
    .eq("id", input.postId)
    .maybeSingle();
  assertQuerySucceeded(postError, "Loading the post");

  if (!post) {
    return { skip: { status: "skipped", reason: "post-not-found" } };
  }

  const [
    { data: settings, error: settingsError },
    { data: connection, error: connectionError },
    { data: commentRows, error: commentsError },
    { data: draftRows, error: draftsError },
    knowledgeFiles,
  ] = await Promise.all([
    supabase
      .from("ai_settings")
      .select("comment_system_prompt, model")
      .eq("workspace_id", input.workspaceId)
      .maybeSingle(),
    supabase
      .from("channel_connections")
      .select("id, platform, capabilities")
      .eq("workspace_id", input.workspaceId)
      .eq("id", post.channel_connection_id)
      .maybeSingle(),
    supabase
      .from("comments")
      .select(
        "id, contact_identity_id, external_id, parent_external_id, direction, text, created_at",
      )
      .eq("workspace_id", input.workspaceId)
      .eq("post_id", input.postId)
      .order("created_at", { ascending: true }),
    supabase
      .from("comment_drafts")
      .select("comment_id, status, text")
      .eq("workspace_id", input.workspaceId)
      .eq("post_id", input.postId)
      .in("status", ["generating", "ready", "edited"]),
    listKnowledgeFiles(supabase, input.workspaceId),
  ]);

  assertQuerySucceeded(settingsError, "Loading AI settings");
  assertQuerySucceeded(connectionError, "Loading channel capabilities");
  assertQuerySucceeded(commentsError, "Loading post comments");
  assertQuerySucceeded(draftsError, "Loading existing comment drafts");

  if (!settings) {
    throw new Error("Workspace AI settings are unavailable.");
  }
  if (!connection) {
    return { skip: { status: "skipped", reason: "channel-unavailable" } };
  }

  const comments = (commentRows ?? []) as CommentRow[];
  const activeDrafts = (draftRows ?? []) as Array<{
    comment_id: string;
    status: string;
    text: string;
  }>;
  const commentsWithActiveDraft = new Set(
    activeDrafts.map((draft) => draft.comment_id),
  );

  const targetRows = selectTargetComments(
    comments,
    commentsWithActiveDraft,
    input.commentId,
  );

  if (targetRows.length === 0) {
    return { skip: { status: "skipped", reason: "no-target-comments" } };
  }

  const identityIds = [
    ...new Set(
      comments
        .map((comment) => comment.contact_identity_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const authorNames = new Map<string, string>();

  if (identityIds.length > 0) {
    const { data: identities, error: identitiesError } = await supabase
      .from("contact_identities")
      .select("id, display_name, external_id")
      .eq("workspace_id", input.workspaceId)
      .in("id", identityIds);
    assertQuerySucceeded(identitiesError, "Loading comment authors");

    for (const identity of (identities ?? []) as Array<{
      id: string;
      display_name: string | null;
      external_id: string;
    }>) {
      authorNames.set(
        identity.id,
        identity.display_name?.trim() || identity.external_id,
      );
    }
  }

  const describe = (comment: CommentRow) => ({
    authorName: comment.contact_identity_id
      ? (authorNames.get(comment.contact_identity_id) ?? "Комментатор")
      : "Комментатор",
    text: comment.text,
  });
  const byExternalId = new Map(
    comments
      .filter((comment) => comment.external_id !== null)
      .map((comment) => [comment.external_id!, comment] as const),
  );

  const targets: CommentDraftTarget[] = targetRows.map((comment) => {
    const parentComment = comment.parent_external_id
      ? byExternalId.get(comment.parent_external_id)
      : undefined;

    return {
      commentId: comment.id,
      ...describe(comment),
      ...(parentComment ? { parent: describe(parentComment) } : {}),
    };
  });

  return {
    workspaceId: input.workspaceId,
    postId: input.postId,
    postText: typeof post.text === "string" ? post.text : "",
    brief: {
      description:
        typeof post.draft_description === "string" ? post.draft_description : "",
      instruction:
        typeof post.draft_instruction === "string" ? post.draft_instruction : "",
    },
    aiSettings: normalizeAiSettings(settings as Record<string, unknown>),
    channelCapabilities: channelCapabilities(
      connection.platform,
      connection.capabilities,
    ),
    knowledgeBase: buildKnowledgeBaseContext(
      knowledgeFiles satisfies KnowledgeFileRow[],
    ),
    targets,
    // A regenerate run for one comment still sees its siblings' replies, so the
    // new text stays distinct from them too.
    existingDraftTexts: activeDrafts
      .filter(
        (draft) =>
          draft.text.trim() !== "" &&
          !targets.some((target) => target.commentId === draft.comment_id),
      )
      .map((draft) => draft.text),
  };
}

export async function startCommentDraft(input: {
  workspaceId: string;
  commentId: string;
  kbFileIds: string[];
}): Promise<string | null> {
  "use step";

  const supabase = createAdminSupabaseClient();
  const { data, error } = await supabase.rpc("start_comment_draft_generation", {
    target_workspace_id: input.workspaceId,
    target_comment_id: input.commentId,
    draft_kb_file_ids: input.kbFileIds,
  });
  assertQuerySucceeded(error, "Starting a comment draft");

  return typeof data === "string" && data.length > 0 ? data : null;
}

export async function finalizeCommentDraft(input: {
  workspaceId: string;
  draftId: string;
  text: string;
  model: string;
}): Promise<void> {
  "use step";

  const supabase = createAdminSupabaseClient();
  const { data, error } = await supabase.rpc(
    "finalize_comment_draft_generation",
    {
      target_workspace_id: input.workspaceId,
      target_draft_id: input.draftId,
      generated_text: input.text,
      generated_model: input.model,
    },
  );
  assertQuerySucceeded(error, "Finalizing a comment draft");

  if (data !== true) {
    throw new Error("The generating comment draft is no longer available.");
  }
}

/** Removes drafts left `generating` by a failed run so no card stays stuck. */
export async function cleanupGeneratingCommentDrafts(input: {
  workspaceId: string;
  postId: string;
  commentId?: string;
}): Promise<void> {
  const supabase = createAdminSupabaseClient();
  let query = supabase
    .from("comment_drafts")
    .delete()
    .eq("workspace_id", input.workspaceId)
    .eq("post_id", input.postId)
    .eq("status", "generating");

  if (input.commentId) {
    query = query.eq("comment_id", input.commentId);
  }

  const { error } = await query;
  assertQuerySucceeded(error, "Cleaning up generating comment drafts");
}

/**
 * Masks everything that goes into one comment's prompt in a single call, so the
 * placeholder numbering stays consistent across the whole prompt (rule 9 /
 * docs/architecture/09-privacy-gdpr.md).
 */
function maskCommentPrompt(
  context: LoadedCommentDraftsContext,
  target: CommentDraftTarget,
  siblingDraftTexts: readonly string[],
) {
  const values = [
    context.postText,
    context.brief.description,
    context.brief.instruction,
    context.knowledgeBase.text,
    // Промпт маскируется вместе с остальным: в него могли вписать контакты,
    // а `unmaskText` вернёт их в готовый ответ.
    context.aiSettings.commentSystemPrompt,
    target.authorName,
    target.text,
    target.parent?.authorName ?? "",
    target.parent?.text ?? "",
    ...siblingDraftTexts,
  ];
  const { masked, entities } = maskMessages(values);
  let index = 0;
  const postText = masked[index++]!;
  const description = masked[index++]!;
  const instruction = masked[index++]!;
  const knowledgeBaseText = masked[index++]!;
  const commentSystemPrompt = masked[index++]!;
  const targetAuthorName = masked[index++]!;
  const targetText = masked[index++]!;
  const parentAuthorName = masked[index++]!;
  const parentText = masked[index++]!;
  const maskedSiblings = masked.slice(index);

  return {
    entities,
    prompt: buildCommentDraftPrompt({
      aiSettings: { commentSystemPrompt },
      channelCapabilities: context.channelCapabilities,
      knowledgeBase: {
        text: knowledgeBaseText,
        usedFileIds: context.knowledgeBase.usedFileIds,
      },
      maskedPostText: postText,
      brief: { description, instruction },
      target: { authorName: targetAuthorName, text: targetText },
      ...(target.parent
        ? { parent: { authorName: parentAuthorName, text: parentText } }
        : {}),
      siblingDraftTexts: maskedSiblings,
    }),
  };
}

/**
 * Одна генерация: маскирование → промпт → LLM → размаскирование. Всё внутри
 * одного шага, как было в Inngest: ретрай шага означает, что провайдера правда
 * спросили дважды, и `ai_request_log` это честно покажет
 * (docs/architecture/08-ai-subsystem.md).
 *
 * `logPromptIfEnabled` вызывается без явного логгера — по умолчанию он пишет в
 * `console`, а внутри шага доступен полный рантайм Node, поэтому отдельный
 * логгер, который раньше приходил из Inngest, больше не нужен.
 */
export async function generateCommentDraft(input: {
  context: LoadedCommentDraftsContext;
  target: CommentDraftTarget;
  siblingDraftTexts: string[];
  model: string;
  draftId: string;
  workspaceId: string;
}): Promise<string> {
  "use step";

  const { prompt, entities } = maskCommentPrompt(
    input.context,
    input.target,
    input.siblingDraftTexts,
  );
  logPromptIfEnabled(prompt);

  try {
    const completion = await generateCompletionWithUsage(prompt, {
      model: input.model,
      maxTokens: DEFAULT_COMMENT_DRAFT_MAX_TOKENS,
      // Slightly warmer than the DM pipeline's 0.3: several replies under one
      // post must not read as variations of the same sentence.
      temperature: 0.7,
    });

    await recordAiUsage({
      workspaceId: input.workspaceId,
      operation: "draft",
      surface: "comment",
      provider: completion.provider,
      model: completion.model,
      usage: completion.usage,
    });
    await recordAiRequest({
      workspaceId: input.workspaceId,
      operation: "draft",
      surface: "comment",
      provider: completion.provider,
      model: completion.model,
      draftId: input.draftId,
      exchange: completion.exchange,
      usage: completion.usage,
    });

    return unmaskText(completion.text, entities);
  } catch (error) {
    // See the DM pipeline: the provider's error body survives only here.
    if (error instanceof AiProviderError) {
      await recordAiRequest({
        workspaceId: input.workspaceId,
        operation: "draft",
        surface: "comment",
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

/** Шаг-обёртка над уборкой: откат такой же durable, как и работа. */
export async function cleanupGeneratingCommentDraftsStep(input: {
  workspaceId: string;
  postId: string;
  commentId?: string;
}): Promise<void> {
  "use step";

  await cleanupGeneratingCommentDrafts(input);
}

export { resolveGenerationModel };
