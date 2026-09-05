import {
  acquireLeases,
  entityLease,
  releaseLeases,
  workspaceSendLease,
} from "@/lib/workflows/leases";

import {
  loadSendContext,
  markMessageSendFailedStep,
  markMessageSent,
  sendMessageViaAdapter,
  type SendMessageInput,
  type SendMessageResult,
} from "./send-message.steps";

/**
 * Отправка исходящего DM (docs/architecture/07-data-flows.md#63-отправка-ответа):
 * load-context (со сторожами идемпотентности) → send-via-adapter → mark-sent.
 * Сообщение уже лежит в БД как `pending`, прогон запускается IDs-only и текст
 * дочитывает сам (правило 7).
 *
 * Результат шага мемоизируется, поэтому ретрай следующего шага не приводит к
 * повторной отправке. Известное окно at-least-once: падение после того, как
 * провайдер принял отправку, но до записи результата шага, — у Zernio нет
 * ключа идемпотентности, которым его можно было бы закрыть.
 *
 * Когда ретраи шага исчерпаны, ошибка доходит до `catch`, и сообщение
 * помечается `failed` — в треде появляется кнопка «Повторить» вместо вечно
 * висящего `pending`.
 */
export async function sendMessageWorkflow(
  input: SendMessageInput,
): Promise<SendMessageResult> {
  "use workflow";

  const leases = [
    workspaceSendLease(input.workspaceId),
    entityLease("conversation", input.conversationId, input.workspaceId),
  ];
  await acquireLeases(leases);

  try {
    const loaded = await loadSendContext(input);
    if (loaded.status === "skip") {
      return { status: "skipped", reason: loaded.reason };
    }

    const providerMessageId = await sendMessageViaAdapter(loaded.context);

    await markMessageSent({
      workspaceId: input.workspaceId,
      messageId: input.messageId,
      providerMessageId,
    });

    return { status: "sent", providerMessageId };
  } catch (error) {
    await markMessageSendFailedStep({
      workspaceId: input.workspaceId,
      messageId: input.messageId,
    });
    throw error;
  } finally {
    await releaseLeases(leases);
  }
}
