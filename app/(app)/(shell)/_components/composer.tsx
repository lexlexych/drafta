"use client";

/**
 * Нижняя зона треда: строка-заметка о черновике и поле ответа
 * (docs/architecture/10-ui.md, docs/architecture/07-data-flows.md#63-отправка-ответа).
 *
 * Черновик и поле ввода — один компонент, а не соседи, потому что это одно
 * состояние: сгенерированный текст попадает прямо в поле, оператор правит его
 * там же и отправляет обычной кнопкой. Отдельной панели с собственной
 * отправкой больше нет.
 *
 * Генерация запускается только значком AI (правило «черновик по запросу»,
 * §6.2): действие запускает прогон `generate-draft`, работу он делает с
 * ретраями по шагам, а результат приезжает сюда через Realtime —
 * поэтому поле переживает и перезагрузку страницы, и уход в другой диалог.
 * Предупреждение об истёкшем окне ответа не блокирует отправку — отказ
 * провайдера станет `failed` с кнопкой «Повторить».
 */

import { useRouter } from "next/navigation";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";

import type { ActiveDraftView } from "@/lib/drafts/types";
import type { TemplateLanguage } from "@/lib/i18n/template-languages";
import {
  DRAFT_REALTIME_EVENT,
  reduceActiveDraft,
  type DraftRealtimeEvent,
} from "@/lib/realtime/draft-panel";

import {
  cancelDraftGenerationAction,
  discardDraftAction,
  generateDraftAction,
  sendManualMessageAction,
} from "../inbox/actions";
import { Spinner } from "./activity";
import {
  RegenerateIcon,
  SendIcon,
  SparkIcon,
  StopIcon,
  TrashIcon,
  WarningIcon,
} from "./icons";
import { showToast } from "./stub";
import { TemplatePicker, type ReplyTemplateOption } from "./template-picker";
import draftStyles from "./draft.module.css";
import styles from "./panes.module.css";

/**
 * Страховка на случай, когда прогон не доживает до статуса в базе: пока шаг
 * доедает ретраи, компенсация ещё не сработала, а поле уже нельзя держать
 * заблокированным. Заметно больше обычной генерации (таймаут LLM — 30 с).
 */
const GENERATION_TIMEOUT_MS = 90_000;

/** Максимум роста поля — половина экрана, дальше текст скроллится внутри. */
const MAX_FIELD_HEIGHT_RATIO = 0.5;

/**
 * Черновик приходит двумя путями — пропом с сервера (навигация,
 * `router.refresh()`) и через Realtime. Побеждает более новый; одну и ту же
 * строку различаем по `updated_at`.
 */
function pickLatestDraft(
  a: ActiveDraftView | null,
  b: ActiveDraftView | null,
): ActiveDraftView | null {
  if (!a || !b) {
    return a ?? b;
  }
  if (a.id === b.id) {
    return Date.parse(a.updatedAt) >= Date.parse(b.updatedAt) ? a : b;
  }

  return Date.parse(a.createdAt) >= Date.parse(b.createdAt) ? a : b;
}

export function Composer({
  conversationId,
  workspaceId,
  draft,
  placeholder,
  replyWindowWarning,
  templates = [],
  workspaceLanguage = "en",
}: {
  conversationId: string;
  workspaceId: string;
  draft: ActiveDraftView | null;
  placeholder: string;
  replyWindowWarning: string | null;
  /** Шаблоны, активные для переписки. Пустой список прячет значок целиком. */
  templates?: readonly ReplyTemplateOption[];
  workspaceLanguage?: TemplateLanguage;
}) {
  const router = useRouter();
  const [realtimeDraft, setRealtimeDraft] = useState<ActiveDraftView | null>(
    null,
  );
  // Черновик, который оператор закрыл (отклонил, отменил, отправил). Гасит и
  // серверный проп, который ещё не успел обновиться.
  const [dismissedDraftId, setDismissedDraftId] = useState<string | null>(null);
  // `null` — поле показывает текст черновика как есть; строка — оператор его
  // уже правит (или пишет своё).
  const [value, setValue] = useState<string | null>(null);
  const [editedDraftId, setEditedDraftId] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  // Оптимистичная блокировка: значок нажат, строка `generating` из базы ещё не
  // приехала, но поле уже не должно принимать ввод.
  const [isRequesting, setIsRequesting] = useState(false);
  const fieldRef = useRef<HTMLTextAreaElement | null>(null);

  const latestDraft = pickLatestDraft(realtimeDraft, draft);
  const activeDraft =
    latestDraft && latestDraft.id !== dismissedDraftId ? latestDraft : null;
  const isGenerating =
    activeDraft?.status === "generating" || (isRequesting && !activeDraft);
  const isLocked = isGenerating || isSending;

  // Черновик, готовый лечь в поле. Отказ модели текста не даёт — там оператор
  // пишет сам, поэтому поле остаётся пустым.
  const readyDraft =
    activeDraft &&
    activeDraft.status !== "generating" &&
    !activeDraft.manualReviewReason
      ? activeDraft
      : null;
  const text = value ?? readyDraft?.text ?? "";
  // Отправка текста, пришедшего из черновика, закрывает его как использованный.
  const sourceDraftId = value === null ? (readyDraft?.id ?? null) : editedDraftId;

  const clearField = () => {
    setValue(null);
    setEditedDraftId(null);
  };

  // Поле растёт по содержимому до половины экрана, дальше скроллится внутри.
  useLayoutEffect(() => {
    const field = fieldRef.current;
    if (!field) {
      return;
    }

    field.style.height = "auto";
    const maxHeight = window.innerHeight * MAX_FIELD_HEIGHT_RATIO;
    field.style.height = `${Math.min(field.scrollHeight, maxHeight)}px`;
  }, [text]);

  useEffect(() => {
    const handleDraftChange = (rawEvent: Event) => {
      const event = rawEvent as CustomEvent<DraftRealtimeEvent>;
      const row = event.detail.new;

      if (
        row.workspace_id !== workspaceId ||
        row.conversation_id !== conversationId
      ) {
        return;
      }

      // Прогон исчерпал ретраи — `onFailure` пометил строку `failed`.
      if (row.status === "failed") {
        showToast("Не удалось сгенерировать черновик — попробуйте ещё раз.");
      }

      // Любая строка, кроме `generating`, означает, что запрошенного прогона
      // больше нет. Не сбросить флаг здесь — и погашенный черновик снова
      // покажется «генерацией»: `isRequesting` живёт до появления результата.
      if (row.status !== "generating") {
        setIsRequesting(false);
      }

      // Терминальный статус гасит и серверный проп: тот мог остаться от
      // предыдущего рендера страницы.
      if (
        row.id &&
        (row.status === "failed" ||
          row.status === "discarded" ||
          row.status === "superseded" ||
          row.status === "sent")
      ) {
        setDismissedDraftId(row.id);
      }

      setRealtimeDraft((current) =>
        reduceActiveDraft(current, event.detail, workspaceId, conversationId),
      );
    };

    window.addEventListener(DRAFT_REALTIME_EVENT, handleDraftChange);
    return () => window.removeEventListener(DRAFT_REALTIME_EVENT, handleDraftChange);
  }, [conversationId, workspaceId]);

  const generatingDraftId = activeDraft?.id ?? null;
  useEffect(() => {
    if (!isGenerating) {
      return;
    }

    const timer = setTimeout(() => {
      showToast("Генерация затянулась — поле ответа разблокировано.");
      setIsRequesting(false);
      if (generatingDraftId) {
        setDismissedDraftId(generatingDraftId);
      }
    }, GENERATION_TIMEOUT_MS);

    return () => clearTimeout(timer);
  }, [generatingDraftId, isGenerating]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const outgoing = text.trim();

    if (!outgoing || isLocked) {
      return;
    }

    setIsSending(true);
    const result = await sendManualMessageAction(
      conversationId,
      outgoing,
      sourceDraftId,
    );
    setIsSending(false);

    if (!result.ok) {
      showToast(result.error);
      return;
    }

    clearField();
    setIsRequesting(false);
    if (activeDraft) {
      setDismissedDraftId(activeDraft.id);
    }
    // revalidatePath in the action refreshed the RSC payload; refresh pulls
    // it in so the pending bubble shows up even before realtime catches up.
    router.refresh();
  };

  const generate = async () => {
    if (isLocked) {
      return;
    }

    setIsRequesting(true);
    clearField();
    // Перегенерация: прошлый черновик уходит с глаз сразу, а в базе его
    // вытеснит финализация нового.
    if (activeDraft) {
      setDismissedDraftId(activeDraft.id);
    }

    const result = await generateDraftAction(conversationId);

    if (!result.ok) {
      setIsRequesting(false);
      showToast(result.error);
    }
  };

  const cancelGeneration = async () => {
    setIsRequesting(false);
    if (activeDraft) {
      setDismissedDraftId(activeDraft.id);
    }

    const result = await cancelDraftGenerationAction(conversationId);

    if (!result.ok) {
      showToast(result.error);
    }
  };

  const discard = async () => {
    const discarded = activeDraft;
    clearField();
    setIsRequesting(false);

    if (!discarded) {
      return;
    }

    setDismissedDraftId(discarded.id);
    const result = await discardDraftAction(conversationId, discarded.id);

    if (!result.ok) {
      showToast(result.error);
    }
  };

  /**
   * Текст шаблона кладётся тем же путём, что и ручной ввод: `value` перестаёт
   * быть `null`, поле показывает его вместо черновика, а `sourceDraftId`
   * становится `editedDraftId` — отправка закроет черновик, если он был.
   */
  const applyTemplate = (templateText: string) => {
    if (isLocked) {
      return;
    }

    if (value === null) {
      setEditedDraftId(readyDraft?.id ?? null);
    }
    setValue(templateText);
    fieldRef.current?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter отправляет, как и у прежнего однострочного поля; перенос строки —
    // Shift+Enter.
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  };

  return (
    <div>
      {isGenerating || activeDraft ? (
        <DraftNote
          draft={isGenerating ? null : activeDraft}
          onCancel={() => void cancelGeneration()}
          onRegenerate={() => void generate()}
          onDiscard={() => void discard()}
        />
      ) : null}

      {replyWindowWarning ? (
        <div className={styles.composerWarning} role="note">
          {replyWindowWarning}
        </div>
      ) : null}

      <form className={styles.composer} onSubmit={(event) => void submit(event)}>
        {/* Оба значка живут по одному правилу: они помощники для пустого
            поля, а над набранным текстом только мешали бы. */}
        {!text.trim() && !isLocked ? (
          <>
            <button
              type="button"
              className={styles.draftButton}
              aria-label="Сгенерировать черновик"
              title="Сгенерировать черновик"
              onClick={() => void generate()}
            >
              <SparkIcon size={16} />
            </button>
            <TemplatePicker
              templates={templates}
              workspaceLanguage={workspaceLanguage}
              onPick={applyTemplate}
            />
          </>
        ) : null}
        <textarea
          ref={fieldRef}
          rows={1}
          placeholder={placeholder}
          aria-label="Ответ"
          value={text}
          disabled={isLocked}
          onChange={(event) => {
            // Момент, когда текст черновика становится текстом оператора.
            if (value === null) {
              setEditedDraftId(readyDraft?.id ?? null);
            }
            setValue(event.target.value);
          }}
          onKeyDown={handleKeyDown}
        />
        <button
          type="submit"
          className={styles.sendButton}
          aria-label="Отправить"
          disabled={isLocked || !text.trim()}
        >
          <SendIcon />
        </button>
      </form>
    </div>
  );
}

/**
 * Строка над полем ответа — по умолчанию ровно одна строка; переносится только
 * то, что не поместилось (длинная причина отказа, много категорий).
 *
 * `draft === null` означает «идёт генерация»: у бегущего прогона ещё нет ни
 * категорий, ни текста, зато есть кнопка «стоп».
 */
function DraftNote({
  draft,
  onCancel,
  onRegenerate,
  onDiscard,
}: {
  draft: ActiveDraftView | null;
  onCancel: () => void;
  onRegenerate: () => void;
  onDiscard: () => void;
}) {
  return (
    <section className={draftStyles.note} aria-live="polite">
      <div className={draftStyles.noteBody}>
        {!draft ? (
          <>
            <Spinner size={14} />
            <span className={draftStyles.noteLabel}>Генерация черновика…</span>
          </>
        ) : draft.manualReviewReason ? (
          // Модель отказалась выдумывать недостающие факты — текста нет,
          // отправлять нечего, поэтому и «удалить» тут не над чем.
          <>
            <span className={draftStyles.noteWarning}>
              <WarningIcon /> Требуется ручная обработка
            </span>
            <span className={draftStyles.noteReason}>
              {draft.manualReviewReason}
            </span>
          </>
        ) : (
          <>
            <span className={draftStyles.aiLabel}>
              <SparkIcon /> AI-черновик
            </span>
            {draft.kbFileNames.map((fileName) => (
              <span key={fileName} className={draftStyles.kbFile}>
                {fileName}
              </span>
            ))}
          </>
        )}
      </div>

      <div className={draftStyles.noteActions}>
        {draft ? (
          <>
            <button
              type="button"
              className={draftStyles.noteButton}
              aria-label="Сгенерировать заново"
              title="Сгенерировать заново"
              onClick={onRegenerate}
            >
              <RegenerateIcon />
            </button>
            {draft.manualReviewReason ? null : (
              <button
                type="button"
                className={draftStyles.noteButton}
                aria-label="Удалить черновик"
                title="Удалить черновик"
                onClick={onDiscard}
              >
                <TrashIcon />
              </button>
            )}
          </>
        ) : (
          <button
            type="button"
            className={draftStyles.noteButton}
            aria-label="Остановить генерацию"
            title="Остановить генерацию"
            onClick={onCancel}
          >
            <StopIcon />
          </button>
        )}
      </div>
    </section>
  );
}
