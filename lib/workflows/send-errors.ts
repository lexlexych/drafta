import { FatalError } from "workflow";

/**
 * Классификация ошибок провайдера, общая для всех трёх отправок
 * (docs/architecture/07-data-flows.md#63-отправка-ответа).
 */

/**
 * True для ошибок, которые не станут успешнее от повтора: любой HTTP 4xx,
 * кроме 408 (таймаут) и 429 (лимит) — истёкшее 24-часовое окно WhatsApp,
 * ограничение платформы, кривой идентификатор диалога.
 *
 * Проверяется числовой `status` по duck-typing (у `ZernioApiError` он есть), а
 * не импортом класса ошибки провайдера: правило 4 держит провайдер-специфичные
 * типы внутри `lib/channels/`.
 */
export function isNonRetriableSendError(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status;

  return (
    typeof status === "number" &&
    status >= 400 &&
    status < 500 &&
    status !== 408 &&
    status !== 429
  );
}

/**
 * Окончательный отказ — это `FatalError`: шаг падает сразу, без повторов, и
 * ошибка уходит в тело прогона, где её ловит компенсация. Всё остальное
 * пробрасывается как есть и ретраится по `maxRetries` шага.
 *
 * `FatalError` принимает только текст — ни `cause`, ни собственных полей у него
 * нет, — поэтому HTTP-статус провайдера дописывается в сообщение: иначе
 * единственная зацепка, по которой разбирают отказ, до лога не доедет.
 */
export function rethrowAsWorkflowSendError(error: unknown): never {
  if (isNonRetriableSendError(error)) {
    const status = (error as { status?: number }).status;
    const message =
      error instanceof Error ? error.message : "Provider rejected the send.";

    throw new FatalError(`Provider rejected the send (HTTP ${status}): ${message}`);
  }

  throw error;
}
