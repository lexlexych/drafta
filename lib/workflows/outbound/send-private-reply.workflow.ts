import {
  acquireLeases,
  entityLease,
  releaseLeases,
  workspaceSendLease,
} from "@/lib/workflows/leases";

import {
  loadPrivateReplyContext,
  markPrivateReplyFailedStep,
  markPrivateReplySent,
  sendPrivateReplyViaAdapter,
  type SendCommentPrivateReplyInput,
  type SendCommentPrivateReplyResult,
} from "./send-private-reply.steps";

/**
 * Личное сообщение автору комментария — кнопка «Написать в ЛС»
 * (docs/architecture/05-channels.md). Отправка прогоном с ретраями, никогда из
 * запроса (правило 8).
 *
 * Ограничения платформы у Meta жёсткие: один private reply на комментарий и
 * только в течение 7 дней. Их нарушение приходит как 4xx и становится
 * `FatalError` — повторять нечего, `catch` помечает строку `failed`.
 */
export async function sendPrivateReplyWorkflow(
  input: SendCommentPrivateReplyInput,
): Promise<SendCommentPrivateReplyResult> {
  "use workflow";

  const leases = [
    workspaceSendLease(input.workspaceId),
    entityLease("post", input.postId, input.workspaceId),
  ];
  await acquireLeases(leases);

  try {
    const loaded = await loadPrivateReplyContext(input);
    if (loaded.status === "skip") {
      return { status: "skipped", reason: loaded.reason };
    }

    const providerMessageId = await sendPrivateReplyViaAdapter(loaded.context);

    await markPrivateReplySent({
      workspaceId: input.workspaceId,
      privateReplyId: input.privateReplyId,
      providerMessageId,
    });

    return { status: "sent", providerMessageId };
  } catch (error) {
    await markPrivateReplyFailedStep({
      workspaceId: input.workspaceId,
      privateReplyId: input.privateReplyId,
    });
    throw error;
  } finally {
    await releaseLeases(leases);
  }
}
