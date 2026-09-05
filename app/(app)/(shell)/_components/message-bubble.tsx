"use client";

/**
 * Пузырь сообщения в треде инбокса.
 *
 * Клиентский компонент, хотя сам тред — серверный: значок перевода
 * переключает текст пузыря между оригиналом и переводом, а это состояние
 * экрана, которое `router.refresh()` не должен сбрасывать. Ключ `message.id`
 * в списке стабилен, поэтому показанный перевод переживает и приход нового
 * сообщения по Realtime.
 *
 * Перевод — синхронный `translateMessageAction`, а не фоновый прогон:
 * см. его докстринг в `../inbox/actions.ts`.
 */

import { useState } from "react";

import {
  isTemplateLanguage,
  templateLanguageLabel,
} from "@/lib/i18n/template-languages";

import { translateMessageAction } from "../inbox/actions";
import { Spinner } from "./activity";
import { PictureIcon, TranslateIcon, UndoIcon } from "./icons";
import { RetrySendButton } from "./retry-send-button";
import { showToast } from "./stub";
import styles from "./panes.module.css";
import uiStyles from "./ui.module.css";

export type MessageBubbleTranslation = {
  text: string;
  sourceLanguage: string | null;
};

/**
 * Форма `InboxThreadMessageView` (lib/db/inbox.ts), повторённая здесь намеренно:
 * тот модуль помечен `server-only`, и клиентскому компоненту незачем тянуть за
 * собой его импорт ради одного типа.
 */
export type MessageBubbleMessage = {
  id: string;
  direction: "in" | "out";
  text: string;
  time: string;
  deliveryLabel: string | null;
  attachmentName: string | null;
  canRetrySend: boolean;
  translation: MessageBubbleTranslation | null;
};

export function MessageBubble({
  conversationId,
  message,
}: {
  conversationId: string;
  message: MessageBubbleMessage;
}) {
  // Свежий перевод перекрывает серверный проп, но не заменяет его: если
  // сообщение перевели в другой вкладке, кэш приедет с `router.refresh()` и
  // сработает здесь без запроса.
  const [fetched, setFetched] = useState<MessageBubbleTranslation | null>(null);
  const [isTranslated, setIsTranslated] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);

  const translation = fetched ?? message.translation;
  // У пузыря с одним вложением переводить нечего — это не определение языка,
  // а просто отсутствие текста.
  const canTranslate = message.text.trim().length > 0;
  const originLabel =
    translation?.sourceLanguage && isTemplateLanguage(translation.sourceLanguage)
      ? templateLanguageLabel(translation.sourceLanguage)
      : "Оригинал";

  const toggle = async () => {
    if (isTranslated) {
      setIsTranslated(false);
      return;
    }

    if (translation) {
      // Перевод уже в кэше — ни запроса, ни спиннера.
      setIsTranslated(true);
      return;
    }

    setIsTranslating(true);
    const result = await translateMessageAction(conversationId, message.id);
    setIsTranslating(false);

    if (!result.ok) {
      showToast(result.error);
      return;
    }

    setFetched({ text: result.text, sourceLanguage: result.sourceLanguage });
    setIsTranslated(true);
  };

  const label = isTranslating
    ? "Переводим…"
    : isTranslated
      ? `Показать оригинал — ${originLabel}`
      : "Перевести";

  return (
    <div
      className={`${styles.bubble} ${
        message.direction === "in" ? styles.bubbleIn : styles.bubbleOut
      }`}
    >
      {message.attachmentName ? (
        <>
          <span className={styles.attachment}>
            <PictureIcon /> {message.attachmentName}
          </span>
          <br />
        </>
      ) : null}
      {isTranslated && translation ? translation.text : message.text}
      <div className={styles.bubbleFooter}>
        {canTranslate ? (
          <button
            type="button"
            className={styles.translateToggle}
            onClick={() => void toggle()}
            disabled={isTranslating}
            aria-busy={isTranslating}
            aria-label={label}
            title={label}
          >
            {isTranslating ? (
              <Spinner size={12} />
            ) : isTranslated ? (
              <UndoIcon />
            ) : (
              <TranslateIcon />
            )}
            {isTranslated ? <span>{originLabel}</span> : null}
          </button>
        ) : null}
        <time className={`${styles.bubbleMeta} ${uiStyles.num}`}>
          {message.time}
          {message.deliveryLabel ? ` · ${message.deliveryLabel}` : ""}
        </time>
      </div>
      {message.canRetrySend ? (
        <RetrySendButton
          conversationId={conversationId}
          messageId={message.id}
        />
      ) : null}
    </div>
  );
}
