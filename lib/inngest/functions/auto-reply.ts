import type { AutoReplyRequestedEvent } from "../events";
import { inngest } from "../client";
import { autoReplyCancelledEvent, autoReplyRequestedEvent } from "../events";
import {
  autoReplyDependencies,
  journalFailedAutoReply,
  runAutoReplyPipeline,
  type AutoReplySteps,
} from "./auto-reply-pipeline";

/**
 * Спящий прогон слота не занимает, поэтому ограничение здесь не про ожидание, а
 * про активные шаги: вызов модели и вставку сообщения. Ключ по беседе
 * выстраивает в очередь прогоны одной переписки, ключ по workspace бережёт
 * бюджет LLM тенанта — те же два ключа, что у `generate-draft` и `send-message`
 * (больше двух Inngest и не принимает).
 */
export const AUTO_REPLY_CONCURRENCY = [
  {
    scope: "env" as const,
    key: '"workspace:" + event.data.workspaceId',
    limit: 2,
  },
  {
    scope: "env" as const,
    key: '"conversation:" + event.data.conversationId',
    limit: 1,
  },
] as const;

function stepAdapter(step: unknown): AutoReplySteps {
  // Тот же приём, что в generate-draft.ts и send-message.ts: Inngest типизирует
  // step.run как Promise<Jsonify<T>>, а все значения пайплайна намеренно
  // JSON-сериализуемы и возвращаются как T.
  return step as AutoReplySteps;
}

function isId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/**
 * `auto-reply` (docs/architecture/07-data-flows.md#67-автоответ): входящее
 * попадает сюда, только если контур включён — вебхук проверяет это перед
 * эмитом. Прогон выжидает паузу, классифицирует последнее входящее и отправляет
 * шаблон через существующую `send-message` (правило 8).
 *
 * `cancelOn` — ровно та же конструкция, что у «стоп» в `generate-draft`, и ровно
 * такая же необязательная: ответ оператора отменяет автоответ и без события —
 * прогон перечитывает беседу после сна, а RPC отказывается вставлять за
 * исходящим. Событие экономит вызов модели, не более того.
 *
 * Отмены по собственному триггерному событию здесь нет намеренно: гарантии, что
 * запускающее событие не отменит свой же прогон, в Inngest нет, а отменённый
 * прогон не оставляет строки в журнале. «Новое входящее перезапускает таймер»
 * держится на состоянии БД — см. докстринг пайплайна.
 */
export const autoReply = inngest.createFunction(
  {
    id: "auto-reply",
    triggers: [autoReplyRequestedEvent],
    concurrency: [...AUTO_REPLY_CONCURRENCY],
    cancelOn: [
      {
        event: autoReplyCancelledEvent,
        if: "async.data.conversationId == event.data.conversationId",
      },
    ],
    onFailure: async ({ event, step }) => {
      const original = event.data.event.data as Partial<AutoReplyRequestedEvent>;
      if (
        !isId(original.workspaceId) ||
        !isId(original.conversationId) ||
        !isId(original.messageId)
      ) {
        return;
      }

      await step.run("journal-failed-auto-reply", () =>
        journalFailedAutoReply({
          workspaceId: original.workspaceId!,
          conversationId: original.conversationId!,
          messageId: original.messageId!,
        }),
      );
    },
  },
  async ({ event, step }) =>
    runAutoReplyPipeline(
      event.data,
      stepAdapter(step),
      autoReplyDependencies,
    ),
);
