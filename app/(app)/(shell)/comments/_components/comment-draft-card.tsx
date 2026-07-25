"use client";

import { useState } from "react";

import type { CommentDraftView } from "@/lib/comments/types";

import { RegenerateIcon, SparkIcon } from "../../_components/icons";
import { showToast } from "../../_components/stub";
import draftStyles from "../../_components/draft.module.css";
import uiStyles from "../../_components/ui.module.css";

const STATUS_LABELS: Record<CommentDraftView["status"], string> = {
  generating: "Генерируется…",
  ready: "Готов",
  edited: "Отредактирован",
};

/**
 * One comment's draft reply. Visually the same card as the DM draft panel
 * (`_components/draft-panel.tsx`) and deliberately a separate component: its
 * actions address a comment draft (`comment_drafts`), not a conversation draft,
 * and it has no realtime reducer of its own — the whole screen re-renders from
 * the server when `comment_drafts` changes.
 */
export function CommentDraftCard({
  draft,
  onSend,
  onEdit,
  onDiscard,
  onRegenerate,
  disabled = false,
}: {
  draft: CommentDraftView;
  onSend: () => Promise<void>;
  onEdit: (text: string) => Promise<boolean>;
  onDiscard: () => Promise<void>;
  onRegenerate: () => Promise<void>;
  disabled?: boolean;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(draft.text);
  const [pendingAction, setPendingAction] = useState<
    "edit" | "discard" | "regenerate" | "send" | null
  >(null);

  const isPending = pendingAction !== null || disabled;

  const run = async (
    action: NonNullable<typeof pendingAction>,
    handler: () => Promise<void>,
  ) => {
    setPendingAction(action);
    try {
      await handler();
    } catch (error) {
      console.error("[comments] draft action failed", error);
      showToast("Не удалось выполнить действие.");
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <div className={draftStyles.draft} data-draft-status={draft.status}>
      <div className={draftStyles.top}>
        <span className={draftStyles.aiLabel}>
          <SparkIcon /> AI-черновик
        </span>
        <span
          className={`${draftStyles.status} ${
            draft.status === "edited" ? draftStyles.statusEdited : ""
          }`}
        >
          {STATUS_LABELS[draft.status]}
        </span>
        <span className={draftStyles.caption}>
          {draft.model ?? "Модель не указана"}
        </span>
      </div>

      {draft.status === "generating" ? (
        <>
          <div className={draftStyles.skeleton} style={{ width: "92%" }} />
          <div className={draftStyles.skeleton} style={{ width: "78%" }} />
          <div className={draftStyles.skeleton} style={{ width: "60%" }} />
        </>
      ) : isEditing ? (
        <>
          <textarea
            className={draftStyles.textarea}
            aria-label="Текст черновика"
            value={editValue}
            autoFocus
            disabled={isPending}
            onChange={(event) => setEditValue(event.target.value)}
          />
          <div className={draftStyles.actions}>
            <button
              type="button"
              className={`${uiStyles.button} ${uiStyles.buttonPrimary}`}
              disabled={isPending || !editValue.trim()}
              onClick={() =>
                void run("edit", async () => {
                  if (await onEdit(editValue)) {
                    setIsEditing(false);
                  }
                })
              }
            >
              {pendingAction === "edit" ? "Сохраняется…" : "Сохранить"}
            </button>
            <button
              type="button"
              className={`${uiStyles.button} ${uiStyles.buttonSecondary}`}
              disabled={isPending}
              onClick={() => {
                setEditValue(draft.text);
                setIsEditing(false);
              }}
            >
              Отмена
            </button>
          </div>
        </>
      ) : (
        <>
          <div className={draftStyles.text}>{draft.text}</div>
          {draft.kbFileNames.length > 0 ? (
            <div className={draftStyles.kb}>
              База знаний:
              {draft.kbFileNames.map((fileName) => (
                <span key={fileName} className={draftStyles.kbFile}>
                  {fileName}
                </span>
              ))}
            </div>
          ) : null}
          <div className={draftStyles.actions}>
            <button
              type="button"
              className={`${uiStyles.button} ${uiStyles.buttonPrimary}`}
              disabled={isPending}
              onClick={() => void run("send", onSend)}
            >
              {pendingAction === "send" ? "Отправляется…" : "Отправить"}
            </button>
            <button
              type="button"
              className={`${uiStyles.button} ${uiStyles.buttonSecondary}`}
              disabled={isPending}
              onClick={() => {
                setEditValue(draft.text);
                setIsEditing(true);
              }}
            >
              Править
            </button>
            <button
              type="button"
              className={`${uiStyles.button} ${uiStyles.buttonSecondary}`}
              disabled={isPending}
              onClick={() => void run("discard", onDiscard)}
            >
              {pendingAction === "discard" ? "Отклоняется…" : "Отклонить"}
            </button>
            <button
              type="button"
              className={`${uiStyles.button} ${uiStyles.buttonGhost}`}
              disabled={isPending}
              aria-label="Сгенерировать черновик заново"
              onClick={() => void run("regenerate", onRegenerate)}
            >
              <RegenerateIcon />
              {pendingAction === "regenerate" ? "Запускается…" : "Обновить"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
