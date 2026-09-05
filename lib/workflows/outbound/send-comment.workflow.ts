import {
  acquireLeases,
  entityLease,
  releaseLeases,
  workspaceSendLease,
} from "@/lib/workflows/leases";

import {
  loadCommentSendContext,
  markCommentSendFailedStep,
  markCommentSent,
  sendCommentViaAdapter,
  type SendCommentInput,
  type SendCommentResult,
} from "./send-comment.steps";

/**
 * Публикация ответа на комментарий
 * (docs/architecture/07-data-flows.md#63-отправка-ответа) — прогоном с
 * ретраями, никогда не внутри запроса (правило 8).
 *
 * Лиза `post:<id>` (лимит 1) сохраняет порядок «Отправить все»: ответы под
 * одним постом уходят по одному, а дублирующий запуск не публикует один и тот
 * же ответ дважды — сторожа в `load-context` превращают проигравшего в no-op.
 *
 * Ретраи исчерпаны или провайдер отказал окончательно → `catch` помечает ответ
 * `failed`, и тред рисует «Не доставлено».
 */
export async function sendCommentWorkflow(
  input: SendCommentInput,
): Promise<SendCommentResult> {
  "use workflow";

  const leases = [
    workspaceSendLease(input.workspaceId),
    entityLease("post", input.postId, input.workspaceId),
  ];
  await acquireLeases(leases);

  try {
    const loaded = await loadCommentSendContext(input);
    if (loaded.status === "skip") {
      return { status: "skipped", reason: loaded.reason };
    }

    const providerCommentId = await sendCommentViaAdapter(loaded.context);

    await markCommentSent({
      workspaceId: input.workspaceId,
      replyCommentId: input.replyCommentId,
      providerCommentId,
    });

    return { status: "sent", providerCommentId };
  } catch (error) {
    await markCommentSendFailedStep({
      workspaceId: input.workspaceId,
      replyCommentId: input.replyCommentId,
    });
    throw error;
  } finally {
    await releaseLeases(leases);
  }
}
