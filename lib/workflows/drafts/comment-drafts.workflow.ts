import {
  acquireLeases,
  entityLease,
  releaseLeases,
  workspaceLlmLease,
} from "@/lib/workflows/leases";

import {
  cleanupGeneratingCommentDraftsStep,
  finalizeCommentDraft,
  generateCommentDraft,
  loadCommentDraftsContext,
  resolveGenerationModel,
  startCommentDraft,
  type CommentDraftsInput,
  type CommentDraftsResult,
} from "./comment-drafts.steps";

/**
 * Черновики ответов на комментарии
 * (docs/architecture/07-data-flows.md#64-комментарии). Комментарии никогда не
 * черновятся при поступлении — прогон начинается только по кнопке с экрана
 * «Комментарии», по всему посту или по одному комментарию.
 *
 * Лизы: бюджет LLM воркспейса (лимит 2) и взаимоисключение по посту
 * (лимит 1) — два прогона не должны черновить один пост одновременно.
 *
 * `catch` убирает черновики, оставшиеся в статусе `generating`: иначе на
 * экране навсегда зависла бы карточка со спиннером.
 */
export async function commentDraftsWorkflow(
  input: CommentDraftsInput,
): Promise<CommentDraftsResult> {
  "use workflow";

  const leases = [
    workspaceLlmLease(input.workspaceId),
    entityLease("post", input.postId, input.workspaceId, 600),
  ];
  await acquireLeases(leases);

  try {
    const loaded = await loadCommentDraftsContext(input);
    if ("skip" in loaded) {
      return loaded.skip;
    }

    const context = loaded;
    const generationModel = resolveGenerationModel(context.aiSettings.model);
    // Растёт по ходу прогона: каждый следующий промпт видит все уже
    // сочинённые ответы под этим постом.
    const siblingDraftTexts = [...context.existingDraftTexts];
    let generated = 0;

    for (const target of context.targets) {
      const draftId = await startCommentDraft({
        workspaceId: context.workspaceId,
        commentId: target.commentId,
        kbFileIds: context.knowledgeBase.usedFileIds,
      });

      if (!draftId) {
        // Комментарий исчез (удалили пост или сам комментарий) между загрузкой
        // контекста и стартом черновика — пропускаем его, прогон продолжается.
        continue;
      }

      const completion = await generateCommentDraft({
        context,
        target,
        // Копия, а не сам массив: он растёт после вызова, и промпт должен
        // видеть срез на своей итерации. В прогоне аргументы шага всё равно
        // сериализуются, но полагаться на это в семантике не стоит.
        siblingDraftTexts: [...siblingDraftTexts],
        model: generationModel,
        draftId,
        workspaceId: input.workspaceId,
      });

      await finalizeCommentDraft({
        workspaceId: context.workspaceId,
        draftId,
        text: completion,
        model: generationModel,
      });

      siblingDraftTexts.push(completion);
      generated += 1;
    }

    return { status: "done", generated };
  } catch (error) {
    await cleanupGeneratingCommentDraftsStep(input);
    throw error;
  } finally {
    await releaseLeases(leases);
  }
}
