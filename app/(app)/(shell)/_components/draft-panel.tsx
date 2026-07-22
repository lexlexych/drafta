"use client";

import { useEffect, useRef, useState } from "react";

import type { ActiveDraftView } from "@/lib/drafts/types";
import type { DraftStatus, DraftView } from "@/lib/mock";
import {
  DRAFT_REALTIME_EVENT,
  reduceActiveDraft,
  type DraftRealtimeEvent,
} from "@/lib/realtime/draft-panel";

import {
  discardDraftAction,
  editDraftAction,
  regenerateDraftAction,
  sendDraftAction,
} from "../inbox/actions";
import { RegenerateIcon, SparkIcon } from "./icons";
import { showToast } from "./stub";
import styles from "./draft.module.css";
import uiStyles from "./ui.module.css";

const STATUS_LABELS: Partial<Record<DraftStatus, string>> = {
  generating: "Генерируется…",
  ready: "Готов",
  edited: "Отредактирован",
};

type DraftPanelProps =
  | { draft: DraftView; channelName: string }
  | {
      draft: ActiveDraftView | null;
      workspaceId: string;
      conversationId: string;
    };

/** Existing mock panel remains available to the stage-5 comments screen. */
export function DraftPanel(props: DraftPanelProps) {
  if ("workspaceId" in props) {
    return <WorkspaceDraftPanel {...props} />;
  }

  return <MockDraftPanel {...props} />;
}

function WorkspaceDraftPanel({
  draft,
  workspaceId,
  conversationId,
}: {
  draft: ActiveDraftView | null;
  workspaceId: string;
  conversationId: string;
}) {
  const [activeDraft, setActiveDraft] = useState(draft);
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(draft?.text ?? "");
  const [pendingAction, setPendingAction] = useState<
    "edit" | "discard" | "regenerate" | "send" | null
  >(null);

  useEffect(() => {
    const handleDraftChange = (rawEvent: Event) => {
      const event = rawEvent as CustomEvent<DraftRealtimeEvent>;
      setActiveDraft((current) =>
        reduceActiveDraft(current, event.detail, workspaceId, conversationId),
      );
    };

    window.addEventListener(DRAFT_REALTIME_EVENT, handleDraftChange);
    return () => window.removeEventListener(DRAFT_REALTIME_EVENT, handleDraftChange);
  }, [conversationId, workspaceId]);

  if (!activeDraft) {
    return null;
  }

  const isPending = pendingAction !== null;

  const saveEdit = async () => {
    setPendingAction("edit");
    const result = await editDraftAction(
      conversationId,
      activeDraft.id,
      editValue,
    );
    setPendingAction(null);

    if (!result.ok) {
      showToast(result.error ?? "Не удалось сохранить черновик.");
      return;
    }

    setActiveDraft(result.draft);
    setEditValue(result.draft.text);
    setIsEditing(false);
  };

  const discard = async () => {
    setPendingAction("discard");
    const result = await discardDraftAction(conversationId, activeDraft.id);
    setPendingAction(null);

    if (!result.ok) {
      showToast(result.error ?? "Не удалось отклонить черновик.");
      return;
    }

    setActiveDraft(null);
  };

  const regenerate = async () => {
    setPendingAction("regenerate");
    const result = await regenerateDraftAction(conversationId);
    setPendingAction(null);

    showToast(
      result.ok
        ? "Генерация запущена."
        : (result.error ?? "Не удалось запустить генерацию заново."),
    );
  };

  const send = async () => {
    setPendingAction("send");
    const result = await sendDraftAction(conversationId, activeDraft.id);
    setPendingAction(null);

    if (!result.ok) {
      showToast(result.error);
      return;
    }

    // The realtime reducer will also drop the panel once the draft row's
    // `sent` status arrives — clearing here just makes the UI immediate.
    setActiveDraft(null);
    showToast("Ответ отправляется…");
  };

  return (
    <div className={styles.draft} data-draft-status={activeDraft.status}>
      <DraftHeader
        status={activeDraft.status}
        caption={activeDraft.model ?? "Модель не указана"}
      />

      {activeDraft.status === "generating" ? (
        <GeneratingBody />
      ) : isEditing ? (
        <>
          <textarea
            className={styles.textarea}
            aria-label="Текст черновика"
            value={editValue}
            autoFocus
            disabled={isPending}
            onChange={(event) => setEditValue(event.target.value)}
          />
          <div className={styles.actions}>
            <button
              type="button"
              className={`${uiStyles.button} ${uiStyles.buttonPrimary}`}
              disabled={isPending || !editValue.trim()}
              onClick={() => void saveEdit()}
            >
              {pendingAction === "edit" ? "Сохраняется…" : "Сохранить"}
            </button>
            <button
              type="button"
              className={`${uiStyles.button} ${uiStyles.buttonSecondary}`}
              disabled={isPending}
              onClick={() => {
                setEditValue(activeDraft.text);
                setIsEditing(false);
              }}
            >
              Отмена
            </button>
          </div>
        </>
      ) : (
        <>
          <div className={styles.text}>{activeDraft.text}</div>
          <KnowledgeBaseFiles fileNames={activeDraft.kbFileNames} />
          <div className={styles.actions}>
            <button
              type="button"
              className={`${uiStyles.button} ${uiStyles.buttonPrimary}`}
              disabled={isPending}
              onClick={() => void send()}
            >
              {pendingAction === "send" ? "Отправляется…" : "Принять и отправить"}
            </button>
            <button
              type="button"
              className={`${uiStyles.button} ${uiStyles.buttonSecondary}`}
              disabled={isPending}
              onClick={() => {
                setEditValue(activeDraft.text);
                setIsEditing(true);
              }}
            >
              Править
            </button>
            <button
              type="button"
              className={`${uiStyles.button} ${uiStyles.buttonSecondary}`}
              disabled={isPending}
              onClick={() => void discard()}
            >
              {pendingAction === "discard" ? "Отклоняется…" : "Отклонить"}
            </button>
            <button
              type="button"
              className={`${uiStyles.button} ${uiStyles.buttonGhost}`}
              disabled={isPending}
              onClick={() => void regenerate()}
            >
              <RegenerateIcon />
              {pendingAction === "regenerate" ? "Запускается…" : "Заново"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function DraftHeader({
  status,
  caption,
}: {
  status: DraftStatus;
  caption: string;
}) {
  return (
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
      <span className={styles.caption}>{caption}</span>
    </div>
  );
}

function GeneratingBody() {
  return (
    <>
      <div className={styles.skeleton} style={{ width: "92%" }} />
      <div className={styles.skeleton} style={{ width: "78%" }} />
      <div className={styles.skeleton} style={{ width: "60%" }} />
    </>
  );
}

function KnowledgeBaseFiles({ fileNames }: { fileNames: string[] }) {
  if (fileNames.length === 0) {
    return null;
  }

  return (
    <div className={styles.kb}>
      База знаний:
      {fileNames.map((fileName) => (
        <span key={fileName} className={styles.kbFile}>
          {fileName}
        </span>
      ))}
    </div>
  );
}

function MockDraftPanel({
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

  const text = content.text;

  return (
    <div className={styles.draft}>
      <DraftHeader status={status} caption={draft.caption} />
      {draft.referenceText ? (
        <div className={styles.reference}>{draft.referenceText}</div>
      ) : null}

      {status === "generating" ? (
        <GeneratingBody />
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
                  setContent((current) => ({ ...current, text: editValue.trim() }));
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
          <KnowledgeBaseFiles fileNames={draft.kbFileNames} />
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
