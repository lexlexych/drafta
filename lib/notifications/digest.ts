/**
 * Формат сводки-дайджеста (docs/architecture/11-realtime-pwa.md#частота-уведомлений):
 * **без LLM и без текста сообщений** — счётчики плюс краткий список имён и
 * каналов. Чистые функции, чтобы их можно было тестировать отдельно от Inngest.
 */

export type DigestSender = {
  name: string;
  channel: string;
};

export type DigestSummary = {
  dmCount: number;
  commentCount: number;
  /** Уникальные отправители в порядке появления; уже обрезаны до лимита + флаг. */
  senders: DigestSender[];
  hasMoreSenders: boolean;
};

export const DIGEST_SENDER_LIST_LIMIT = 3;

const RU_MESSAGE_FORMS = ["сообщение", "сообщения", "сообщений"] as const;
const RU_COMMENT_FORMS = ["комментарий", "комментария", "комментариев"] as const;

function pluralRu(count: number, forms: readonly [string, string, string]): string {
  const mod100 = count % 100;
  const mod10 = count % 10;
  if (mod100 >= 11 && mod100 <= 14) {
    return forms[2];
  }
  if (mod10 === 1) {
    return forms[0];
  }
  if (mod10 >= 2 && mod10 <= 4) {
    return forms[1];
  }
  return forms[2];
}

export function isDigestEmpty(summary: DigestSummary): boolean {
  return summary.dmCount === 0 && summary.commentCount === 0;
}

/** «5 новых сообщений, 2 комментария: Anna (WhatsApp Магазин), Max (Instagram)…» */
export function formatDigestBody(summary: DigestSummary): string {
  const parts: string[] = [];
  if (summary.dmCount > 0) {
    parts.push(
      `${summary.dmCount} ${pluralRu(summary.dmCount, RU_MESSAGE_FORMS)}`,
    );
  }
  if (summary.commentCount > 0) {
    parts.push(
      `${summary.commentCount} ${pluralRu(summary.commentCount, RU_COMMENT_FORMS)}`,
    );
  }

  const counts = parts.join(", ");
  if (summary.senders.length === 0) {
    return `${counts} — новые входящие`;
  }

  const senderList = summary.senders
    .map((sender) => `${sender.name} (${sender.channel})`)
    .join(", ");
  const ellipsis = summary.hasMoreSenders ? "…" : "";
  return `${counts}: ${senderList}${ellipsis}`;
}
