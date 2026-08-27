"use client";

/**
 * Лента сообщений открытой переписки.
 *
 * Клиентский компонент, хотя тред вокруг — серверный: сервер отдаёт только
 * последнюю страницу, а предыдущие подтягиваются при скролле вверх
 * (`useThreadWindow`). Он же скроллит ленту вниз при открытии — оператору нужен
 * конец разговора, а не его начало.
 */

import {
  loadOlderMessagesAction,
  type OlderMessagesResult,
} from "../inbox/actions";
import { MessageBubble, type MessageBubbleMessage } from "./message-bubble";
import styles from "./panes.module.css";
import { useThreadWindow } from "./use-thread-window";

/** `InboxThreadMessageView` со стороны клиента — см. `MessageBubbleMessage`. */
export type MessageListMessage = MessageBubbleMessage & {
  createdAt: string;
};

export function MessageList({
  conversationId,
  messages,
  hasMoreBefore,
}: {
  conversationId: string;
  messages: MessageListMessage[];
  hasMoreBefore: boolean;
}) {
  const { items, isPending, error, containerRef, sentinelRef } =
    useThreadWindow<MessageListMessage>({
      serverItems: messages,
      serverHasMoreBefore: hasMoreBefore,
      resetKey: conversationId,
      activityLabel: "Загружаем сообщения…",
      loadOlder: async (before): Promise<OlderMessagesResult> =>
        loadOlderMessagesAction({ conversationId, before }),
    });

  return (
    <div className={styles.messages} ref={containerRef}>
      {/* Маячок стоит над первым сообщением: подгрузка идёт вверх, к более
          старым. */}
      <div aria-hidden="true" ref={sentinelRef} />
      {isPending ? <div className={styles.listMore}>Загружаем ещё…</div> : null}
      {error ? <div className={styles.listMore}>{error}</div> : null}

      {/* Пузырь — клиентский компонент ради значка перевода: он переключает
          текст на месте, и это состояние не должно сбрасываться при
          `router.refresh()` от Realtime. */}
      {items.map((message) => (
        <MessageBubble
          key={message.id}
          conversationId={conversationId}
          message={message}
        />
      ))}
    </div>
  );
}
