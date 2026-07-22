"use client";

/**
 * Поле ручного ответа под панелью черновика (этап 3,
 * docs/architecture/07-data-flows.md#63-отправка-ответа): отправка идёт через
 * server action → транзакционный RPC → Inngest, а не из клиента напрямую.
 * Предупреждение об истёкшем окне ответа не блокирует отправку — отказ
 * провайдера станет `failed` с кнопкой «Повторить».
 */

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { sendManualMessageAction } from "../inbox/actions";
import { SendIcon } from "./icons";
import { showToast, StubButton } from "./stub";
import styles from "./panes.module.css";

/** Прежний композер-заглушка — остаётся экрану комментариев до этапа 5. */
export function MockComposer({ placeholder }: { placeholder: string }) {
  return (
    <div className={styles.composer}>
      <input type="text" placeholder={placeholder} aria-label="Ответ" />
      <StubButton className={styles.sendButton} aria-label="Отправить">
        <SendIcon />
      </StubButton>
    </div>
  );
}

export function Composer({
  conversationId,
  placeholder,
  replyWindowWarning,
}: {
  conversationId: string;
  placeholder: string;
  replyWindowWarning: string | null;
}) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [isSending, setIsSending] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = value.trim();

    if (!text || isSending) {
      return;
    }

    setIsSending(true);
    const result = await sendManualMessageAction(conversationId, text);
    setIsSending(false);

    if (!result.ok) {
      showToast(result.error);
      return;
    }

    setValue("");
    // revalidatePath in the action refreshed the RSC payload; refresh pulls
    // it in so the pending bubble shows up even before realtime catches up.
    router.refresh();
  };

  return (
    <div>
      {replyWindowWarning ? (
        <div className={styles.composerWarning} role="note">
          {replyWindowWarning}
        </div>
      ) : null}
      <form className={styles.composer} onSubmit={(event) => void submit(event)}>
        <input
          type="text"
          placeholder={placeholder}
          aria-label="Ответ"
          value={value}
          disabled={isSending}
          onChange={(event) => setValue(event.target.value)}
        />
        <button
          type="submit"
          className={styles.sendButton}
          aria-label="Отправить"
          disabled={isSending || !value.trim()}
        >
          <SendIcon />
        </button>
      </form>
    </div>
  );
}
