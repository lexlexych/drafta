import type { NormalizedEvent, NormalizedSender } from "@/lib/channels/types";
import { normalizeIgnoredSenderIdentifier } from "@/lib/ignored-senders/validation";

/**
 * Кандидаты для сверки со списком исключённых отправителей
 * (docs/architecture/05-channels.md#исключённые-отправители).
 *
 * Отдельный модуль, потому что читателей два: `process-event.ts` (обычный путь)
 * и `journal-unparsed.ts` (конверты, которые адаптер не разобрал).
 */

/**
 * Человек на той стороне — если у события он вообще есть.
 *
 * Список гасит только личные сообщения и диалоги. `comment.received` сюда
 * намеренно не входит: комментарии публичные и относятся к бизнесу, даже когда
 * их оставил тот же человек, чьи ЛС не нужны. `post.published` — наша
 * собственная публикация, собеседника у неё нет.
 */
function eventParticipant(event: NormalizedEvent): NormalizedSender | undefined {
  switch (event.type) {
    case "message.received":
    case "message.delivered":
    case "message.read":
    case "message.failed":
      return event.message.sender;
    case "conversation.started":
    case "message.sent":
      return event.participant;
    default:
      return undefined;
  }
}

/**
 * Нормализованные адреса участника: то, с чем сравнивается `ignored_senders`.
 * Пустой массив — сравнивать не с чем, событие идёт обычным путём.
 *
 * `externalId` попадает в кандидаты наравне с `handles`: у платформы, где он и
 * есть публичный адрес, правило продолжит работать, а внутренний ID Zernio
 * (`wa_user_60214`) нормализатор отбросит сам — на то он и проверяет форму
 * значения, прежде чем оставить в нём одни цифры.
 */
export function ignoredSenderCandidates(event: NormalizedEvent): string[] {
  const participant = eventParticipant(event);

  if (!participant) {
    return [];
  }

  return normalizeCandidates(event.platform, [
    participant.externalId,
    ...(participant.handles ?? []),
  ]);
}

/** То же для конверта, который адаптер не разобрал: у него нормализованного события нет. */
export function normalizeCandidates(
  platform: string,
  values: readonly string[],
): string[] {
  const normalized = values
    .map((value) => normalizeIgnoredSenderIdentifier(platform, value))
    .filter((value): value is string => value !== null);

  return [...new Set(normalized)];
}
