"use client";

/**
 * «Повторить» под неотправленным (failed) исходящим сообщением (этап 3,
 * docs/architecture/07-data-flows.md#63-отправка-ответа): server action
 * возвращает сообщение в `pending` и заново эмитит `message/send`.
 */

import { useRouter } from "next/navigation";
import { useState } from "react";

import { retrySendMessageAction } from "../inbox/actions";
import { showToast } from "./stub";
import styles from "./panes.module.css";
import uiStyles from "./ui.module.css";

export function RetrySendButton({
  conversationId,
  messageId,
}: {
  conversationId: string;
  messageId: string;
}) {
  const router = useRouter();
  const [isRetrying, setIsRetrying] = useState(false);

  const retry = async () => {
    setIsRetrying(true);
    const result = await retrySendMessageAction(conversationId, messageId);
    setIsRetrying(false);

    if (!result.ok) {
      showToast(result.error);
      return;
    }

    showToast("Отправка запущена заново.");
    router.refresh();
  };

  return (
    <button
      type="button"
      className={`${uiStyles.button} ${uiStyles.buttonSmall} ${uiStyles.buttonSecondary} ${styles.retrySend}`}
      disabled={isRetrying}
      onClick={() => void retry()}
    >
      {isRetrying ? "Повторяется…" : "Повторить"}
    </button>
  );
}
