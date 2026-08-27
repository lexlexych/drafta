"use client";

import {
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";

import { SendIcon } from "../../_components/icons";
import {
  TemplatePicker,
  type ReplyTemplateOption,
} from "../../_components/template-picker";
import paneStyles from "../../_components/panes.module.css";
import type { TemplateLanguage } from "@/lib/i18n/template-languages";
import styles from "../comments.module.css";

/**
 * Поле ответа, раскрывающееся прямо под комментарием.
 *
 * Не переиспользует `_components/composer.tsx`: тот завязан на действия инбокса
 * и на редьюсер AI-черновиков — здесь нет ни того, ни другого. Общее у них
 * ровно то, что и должно быть общим: `TemplatePicker` (он ничего не знает об
 * инбоксе) и оформление поля из `panes.module.css`.
 *
 * `surface` шаблонов задаёт вызывающий: у «Ответить» это шаблоны комментариев,
 * у «Написать в ЛС» — шаблоны сообщений.
 */

/** До какой доли экрана поле растёт вслед за текстом. */
const MAX_FIELD_HEIGHT_RATIO = 0.4;

export function InlineComposer({
  placeholder,
  templates,
  workspaceLanguage,
  onSubmit,
  onCancel,
}: {
  placeholder: string;
  templates: readonly ReplyTemplateOption[];
  workspaceLanguage: TemplateLanguage;
  /** Возвращает `true`, если отправка удалась и поле пора закрыть. */
  onSubmit: (text: string) => Promise<boolean>;
  onCancel: () => void;
}) {
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState("");
  const [isSending, setIsSending] = useState(false);

  // Поле растёт вслед за текстом, но не выше доли экрана — дальше скроллится.
  useLayoutEffect(() => {
    const field = fieldRef.current;
    if (!field) return;

    field.style.height = "auto";
    const limit = Math.round(window.innerHeight * MAX_FIELD_HEIGHT_RATIO);
    field.style.height = `${Math.min(field.scrollHeight, limit)}px`;
  }, [text]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const outgoing = text.trim();

    if (!outgoing || isSending) {
      return;
    }

    setIsSending(true);
    const sent = await onSubmit(outgoing);
    setIsSending(false);

    if (sent) {
      setText("");
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Как в поле ответа переписки: Enter отправляет, Shift+Enter переносит.
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
      return;
    }

    if (event.key === "Escape" && !isSending) {
      onCancel();
    }
  };

  return (
    <form
      className={`${paneStyles.composer} ${styles.inlineComposer}`}
      onSubmit={(event) => void submit(event)}
    >
      {/* Значок шаблонов — помощник для пустого поля; над набранным текстом
          он только мешал бы, ровно как в переписке. */}
      {!text.trim() && !isSending ? (
        <TemplatePicker
          templates={templates}
          workspaceLanguage={workspaceLanguage}
          onPick={(templateText) => {
            setText(templateText);
            fieldRef.current?.focus();
          }}
        />
      ) : null}
      <textarea
        ref={fieldRef}
        rows={1}
        autoFocus
        placeholder={placeholder}
        aria-label={placeholder}
        value={text}
        disabled={isSending}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={handleKeyDown}
      />
      <button
        type="submit"
        className={paneStyles.sendButton}
        aria-label="Отправить"
        disabled={isSending || !text.trim()}
      >
        <SendIcon />
      </button>
    </form>
  );
}
