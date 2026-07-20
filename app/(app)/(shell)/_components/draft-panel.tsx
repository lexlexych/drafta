"use client";

/**
 * Панель AI-черновика: принять / править / отклонить / сгенерировать заново.
 *
 * В T-07 все действия — заглушки без побочных эффектов: состояние живёт только
 * в компоненте, «заново» подставляет альтернативный текст из mock-данных.
 * Реальные генерация (этап 2) и отправка (этап 3) заменят локальное состояние.
 */

import { useEffect, useRef, useState } from "react";

import type { DraftStatus, DraftView } from "@/lib/mock";

import { RegenerateIcon, SparkIcon } from "./icons";
import { showToast } from "./stub";
import styles from "./draft.module.css";
import uiStyles from "./ui.module.css";

const STATUS_LABELS: Partial<Record<DraftStatus, string>> = {
  generating: "Генерируется…",
  ready: "Готов",
  edited: "Отредактирован",
};

export function DraftPanel({
  draft,
  channelName,
}: {
  draft: DraftView;
  channelName: string;
}) {
  const [status, setStatus] = useState<DraftStatus>(draft.status);
  const [content, setContent] = useState({
    text: draft.text,
    alternative: draft.alternativeText,
  });
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(draft.text);
  const regenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Черновик «генерируется» — mock завершает генерацию сам, подменяя текст
    // альтернативным вариантом из mock-данных.
    if (status === "generating" && !regenTimerRef.current) {
      regenTimerRef.current = setTimeout(() => {
        regenTimerRef.current = null;
        setContent(({ text, alternative }) => ({
          text: alternative || text,
          alternative: text || alternative,
        }));
        setStatus("ready");
      }, 1400);
    }

    return () => {
      if (regenTimerRef.current) {
        clearTimeout(regenTimerRef.current);
        regenTimerRef.current = null;
      }
    };
  }, [status]);

  const text = content.text;

  if (status === "sent") {
    return null;
  }

  if (status === "discarded") {
    return (
      <div className={styles.done}>
        <SparkIcon />
        Черновик отклонён
        <button
          type="button"
          className={`${uiStyles.button} ${uiStyles.buttonSmall} ${uiStyles.buttonSecondary} ${styles.doneAction}`}
          onClick={() => setStatus("generating")}
        >
          <RegenerateIcon /> Сгенерировать заново
        </button>
      </div>
    );
  }

  return (
    <div className={styles.draft}>
      <div className={styles.top}>
        <span className={styles.aiLabel}>
          <SparkIcon /> AI-черновик
        </span>
        <span
          className={`${styles.status} ${
            status === "edited" ? styles.statusEdited : ""
          }`}
        >
          {STATUS_LABELS[status] ?? status}
        </span>
        <span className={styles.caption}>{draft.caption}</span>
      </div>

      {draft.referenceText ? (
        <div className={styles.reference}>{draft.referenceText}</div>
      ) : null}

      {status === "generating" ? (
        <>
          <div className={styles.skeleton} style={{ width: "92%" }} />
          <div className={styles.skeleton} style={{ width: "78%" }} />
          <div className={styles.skeleton} style={{ width: "60%" }} />
        </>
      ) : isEditing ? (
        <>
          <textarea
            className={styles.textarea}
            aria-label="Текст черновика"
            value={editValue}
            autoFocus
            onChange={(event) => setEditValue(event.target.value)}
          />
          <div className={styles.actions}>
            <button
              type="button"
              className={`${uiStyles.button} ${uiStyles.buttonPrimary}`}
              onClick={() => {
                if (editValue.trim()) {
                  setContent((current) => ({
                    ...current,
                    text: editValue.trim(),
                  }));
                  setStatus("edited");
                }

                setIsEditing(false);
              }}
            >
              Сохранить
            </button>
            <button
              type="button"
              className={`${uiStyles.button} ${uiStyles.buttonSecondary}`}
              onClick={() => setIsEditing(false)}
            >
              Отмена
            </button>
          </div>
        </>
      ) : (
        <>
          <div className={styles.text}>{text}</div>
          {draft.kbFileNames.length > 0 ? (
            <div className={styles.kb}>
              База знаний:
              {draft.kbFileNames.map((fileName) => (
                <span key={fileName} className={styles.kbFile}>
                  {fileName}
                </span>
              ))}
            </div>
          ) : null}
          <div className={styles.actions}>
            <button
              type="button"
              className={`${uiStyles.button} ${uiStyles.buttonPrimary}`}
              onClick={() => {
                setStatus("sent");
                showToast(`Ответ отправлен через ${channelName}`);
              }}
            >
              Принять и отправить
            </button>
            <button
              type="button"
              className={`${uiStyles.button} ${uiStyles.buttonSecondary}`}
              onClick={() => {
                setEditValue(text);
                setIsEditing(true);
              }}
            >
              Править
            </button>
            <button
              type="button"
              className={`${uiStyles.button} ${uiStyles.buttonSecondary}`}
              onClick={() => setStatus("discarded")}
            >
              Отклонить
            </button>
            <button
              type="button"
              className={`${uiStyles.button} ${uiStyles.buttonGhost}`}
              onClick={() => setStatus("generating")}
            >
              <RegenerateIcon /> Заново
            </button>
          </div>
        </>
      )}
    </div>
  );
}
