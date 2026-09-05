import { getWorkflowMetadata } from "workflow";

import {
  acquireLeases,
  entityLease,
  releaseLeases,
  workspaceLlmLease,
} from "@/lib/workflows/leases";

import {
  createGeneratingDraft,
  failGeneratingDraftsStep,
  finalizeDraft,
  generateDraftCompletion,
  loadDraftContext,
  maskDraftContext,
  resolveGenerationModel,
  resolveMatchedCategoryIds,
  restoreAndParseCompletion,
  type GenerateDraftInput,
  type GenerateDraftResult,
} from "./generate-draft.steps";

/**
 * Единственный способ, которым вообще появляется черновик к переписке
 * (docs/architecture/07-data-flows.md#62-генерация-черновика): входящее
 * сообщение ничего не запускает, оператор жмёт значок AI в поле ввода треда.
 *
 * Отмена («стоп» под спиннером) больше не ищет прогон по событию, как делал
 * `cancelOn`: `createGeneratingDraft` записывает `runId` в строку черновика, и
 * действие отмены зовёт по нему `run.cancel()`. Прогон останавливается на
 * границе шага — уже улетевший запрос к провайдеру всё равно дойдёт до конца,
 * но до `finalize` дело не дойдёт, а действие к тому моменту уже погасило
 * черновик, за которым и следит композер.
 *
 * Лизы — бывший `concurrency`: бюджет LLM воркспейса (лимит 2) ограничивает,
 * сколько можно сжечь, тыкая в значок, а лиза переписки (лимит 1) не даёт двум
 * прогонам финализировать один и тот же тред.
 */
export async function generateDraftWorkflow(
  input: GenerateDraftInput,
): Promise<GenerateDraftResult> {
  "use workflow";

  const { workflowRunId } = getWorkflowMetadata();

  const leases = [
    workspaceLlmLease(input.workspaceId),
    entityLease("conversation", input.conversationId, input.workspaceId, 600),
  ];
  await acquireLeases(leases);

  try {
    const context = await loadDraftContext(input);
    if (!context) {
      return { status: "skipped", reason: "no-incoming" };
    }

    const generationModel = resolveGenerationModel(context.aiSettings.model);
    const maskedContext = await maskDraftContext(context);
    const draftId = await createGeneratingDraft({
      context: maskedContext,
      workflowRunId,
    });

    const completion = await generateDraftCompletion({
      maskedContext,
      model: generationModel,
      draftId,
      workspaceId: input.workspaceId,
    });

    const parsed = await restoreAndParseCompletion({
      completion,
      maskedContext,
    });

    // Имена категорий модель копирует из фрагментов базы знаний, поэтому
    // разворачиваем их в id по полному списку категорий workspace, а не только
    // по активным: выключенная после генерации категория всё ещё осмысленный
    // ответ.
    const matchedKbFileIds = resolveMatchedCategoryIds(
      context.knowledgeFiles,
      parsed.categoryNames,
    );

    await finalizeDraft({
      workspaceId: input.workspaceId,
      draftId,
      text: parsed.text,
      model: generationModel,
      manualReviewReason: parsed.manualReviewReason,
      matchedKbFileIds,
    });

    return { status: "ready", draftId };
  } catch (error) {
    await failGeneratingDraftsStep({
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
    });
    throw error;
  } finally {
    await releaseLeases(leases);
  }
}
