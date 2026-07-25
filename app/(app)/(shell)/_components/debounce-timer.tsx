"use client";

/**
 * Обратный отсчёт до запуска генерации черновика.
 *
 * Сам дебаунс живёт внутри Inngest-прогона, поэтому браузеру показывать нечего
 * — кроме дедлайна, который пайплайн публикует в
 * `conversations.draft_debounce_until` (миграция 20260725120000). Обновление
 * дедлайна прилетает по Realtime (`conversations` уже в публикации), а тикает
 * счётчик локально.
 */

import { useEffect, useState } from "react";

import { runDraftNowAction } from "../inbox/actions";
import { ClockIcon } from "./icons";
import { showToast } from "./stub";
import styles from "./draft.module.css";
import uiStyles from "./ui.module.css";

function secondsLeft(deadline: string, now: number): number {
  const parsed = Date.parse(deadline);

  if (Number.isNaN(parsed)) {
    return 0;
  }

  return Math.max(0, Math.ceil((parsed - now) / 1000));
}

function formatCountdown(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function DebounceTimer({
  conversationId,
  deadline,
}: {
  conversationId: string;
  deadline: string;
}) {
  const [remaining, setRemaining] = useState(() =>
    secondsLeft(deadline, Date.now()),
  );
  const [isStarting, setIsStarting] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => {
      setRemaining(secondsLeft(deadline, Date.now()));
    }, 1000);

    return () => clearInterval(interval);
  }, [deadline]);

  // Прогон уже вышел из окна ожидания — дальше состояние покажет сама панель
  // черновика («Генерируется…»), дублировать нулевой таймер незачем.
  if (remaining <= 0) {
    return null;
  }

  const runNow = async () => {
    setIsStarting(true);
    const result = await runDraftNowAction(conversationId);
    setIsStarting(false);

    if (!result.ok) {
      showToast(result.error ?? "Не удалось запустить генерацию.");
      return;
    }

    setRemaining(0);
  };

  return (
    <section className={styles.debounce} aria-live="polite">
      <span className={styles.debounceIcon} aria-hidden="true">
        <ClockIcon />
      </span>
      <span className={styles.debounceBody}>
        <b>Черновик через {formatCountdown(remaining)}</b>
        <span className={styles.debounceHint}>
          Ждём, не придёт ли ещё сообщение — ответим на всю пачку сразу.
        </span>
      </span>
      <button
        type="button"
        className={`${uiStyles.button} ${uiStyles.buttonSecondary} ${uiStyles.buttonSmall}`}
        onClick={runNow}
        disabled={isStarting}
      >
        {isStarting ? "Запускаем…" : "Запустить сейчас"}
      </button>
    </section>
  );
}
