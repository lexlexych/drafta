"use client";

import { useState, type FormEvent } from "react";

import type { PostDraftBriefView } from "@/lib/comments/types";

import uiStyles from "../../_components/ui.module.css";
import styles from "../comments.module.css";

/**
 * The «Черновики» dialog: both inputs are optional, because a post can be
 * self-explanatory. What the user types is stored on the post and fed to every
 * reply generated for it — the description explains what the post shows (the
 * model cannot watch the video), the instruction says how to answer.
 */
export function DraftBriefDialog({
  brief,
  isPending,
  onCancel,
  onConfirm,
}: {
  brief: PostDraftBriefView;
  isPending: boolean;
  onCancel: () => void;
  onConfirm: (input: { description: string; instruction: string }) => void;
}) {
  const [description, setDescription] = useState(brief.description);
  const [instruction, setInstruction] = useState(brief.instruction);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onConfirm({ description, instruction });
  }

  return (
    <div
      className={styles.dialogBackdrop}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isPending) {
          onCancel();
        }
      }}
    >
      <section
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="comment-drafts-title"
      >
        <form onSubmit={handleSubmit}>
          <div className={styles.dialogHeader}>
            <div>
              <h2 id="comment-drafts-title">Черновики к комментариям</h2>
              <p>
                Черновик будет создан для каждого комментария без ответа. Ответы
                учитывают текст поста, описание ниже и сам комментарий.
              </p>
            </div>
            <button
              type="button"
              className={`${uiStyles.button} ${uiStyles.buttonGhost}`}
              onClick={onCancel}
              disabled={isPending}
              aria-label="Закрыть окно черновиков"
            >
              ✕
            </button>
          </div>

          <div className={styles.dialogBody}>
            <label className={styles.dialogField}>
              Описание поста (необязательно)
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Например: на видео мы показываем сборку нового стеллажа."
                rows={3}
                disabled={isPending}
                autoFocus
              />
              <span>
                AI не видит фото и видео — опишите, что происходит в посте.
              </span>
            </label>

            <label className={styles.dialogField}>
              Как отвечать (необязательно)
              <textarea
                value={instruction}
                onChange={(event) => setInstruction(event.target.value)}
                placeholder="Например: поблагодарить за тёплые слова, на вопросы о цене звать в директ."
                rows={3}
                disabled={isPending}
              />
              <span>Правило применяется ко всем ответам под этим постом.</span>
            </label>
          </div>

          <div className={styles.dialogActions}>
            <button
              type="button"
              className={`${uiStyles.button} ${uiStyles.buttonSecondary}`}
              onClick={onCancel}
              disabled={isPending}
            >
              Отмена
            </button>
            <button
              type="submit"
              className={`${uiStyles.button} ${uiStyles.buttonPrimary}`}
              disabled={isPending}
            >
              {isPending ? "Запускается…" : "Создать черновики"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
