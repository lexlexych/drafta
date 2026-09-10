"use client";

/**
 * Список исключённых отправителей под строкой подключённого канала
 * (docs/architecture/05-channels.md#исключённые-отправители).
 *
 * Малый бизнес часто держит бизнес-аккаунт на том же номере, что и личный, и не
 * хочет видеть в drafta переписку с семьёй. Адрес из этого списка отбрасывается
 * ещё в вебхуке — ни контакта, ни переписки не появляется.
 *
 * Отдельный компонент, а не врезка в `channels-panel.tsx`: у панели каналов всё
 * состояние лежит наверху и на блок, а модалка со своим черновиком туда не
 * ложится. Контур редактора — как у `settings/templates/templates-panel.tsx`.
 */

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import {
  MAX_IGNORED_SENDER_LABEL_LENGTH,
  validateIgnoredSender,
  type IgnoredSenderPlatform,
} from "@/lib/ignored-senders/validation";

import { PencilIcon, PlusIcon } from "../../_components/icons";
import setStyles from "../settings.module.css";
import uiStyles from "../../_components/ui.module.css";
import { useActivityTransition } from "../../_components/activity";
import {
  createIgnoredSenderAction,
  deleteIgnoredSenderAction,
  updateIgnoredSenderAction,
} from "./actions";

export type IgnoredSenderListItem = {
  id: string;
  platform: IgnoredSenderPlatform;
  /** Нормализованный адрес — ровно как в БД; для показа его одевают обратно. */
  identifier: string;
  label: string;
};

type EditorState = {
  /** `null` — создание новой записи; кнопка «Удалить» появляется только у существующей. */
  id: string | null;
  label: string;
  identifier: string;
};

const COPY: Record<
  IgnoredSenderPlatform,
  {
    title: string;
    add: string;
    hint: string;
    field: string;
    placeholder: string;
    empty: string;
  }
> = {
  whatsapp: {
    title: "Игнорировать сообщения с номеров",
    add: "Добавить номер",
    hint: "Сообщения с этих номеров не попадут в drafta: ни переписка, ни контакт не сохранятся. Уже полученные сообщения останутся — удалите переписку вручную.",
    field: "Номер телефона",
    placeholder: "+49 151 2345678",
    empty: "Личные номера, переписку с которыми не нужно показывать в drafta.",
  },
  instagram: {
    title: "Игнорировать сообщения от аккаунтов",
    add: "Добавить аккаунт",
    hint: "Сообщения от этих аккаунтов не попадут в drafta: ни переписка, ни контакт не сохранятся. Уже полученные сообщения останутся — удалите переписку вручную. Комментарии под публикациями это не затрагивает.",
    field: "Имя пользователя",
    placeholder: "@lena.fischer",
    empty: "Личные аккаунты, переписку с которыми не нужно показывать в drafta.",
  },
};

/** В базе адрес лежит нормализованным — человеку его показывают в привычном виде. */
function displayIdentifier(entry: IgnoredSenderListItem): string {
  return entry.platform === "whatsapp" ? `+${entry.identifier}` : `@${entry.identifier}`;
}

/** «Анна: +491512345678» — или один адрес, если имя не задали. */
function chipText(entry: IgnoredSenderListItem): string {
  const address = displayIdentifier(entry);
  return entry.label ? `${entry.label}: ${address}` : address;
}

export function IgnoredSendersField({
  platform,
  entries,
}: {
  platform: IgnoredSenderPlatform;
  entries: IgnoredSenderListItem[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useActivityTransition(
    "Сохраняем список исключений…",
  );
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const copy = COPY[platform];
  // Блоков на странице два (WhatsApp и Instagram) — id заголовка обязан различаться.
  const titleId = `ignored-senders-editor-${platform}`;

  function openNew() {
    setError(null);
    setEditor({ id: null, label: "", identifier: "" });
  }

  function openExisting(entry: IgnoredSenderListItem) {
    setError(null);
    setEditor({
      id: entry.id,
      label: entry.label,
      identifier: displayIdentifier(entry),
    });
  }

  function closeEditor() {
    setEditor(null);
    setError(null);
  }

  function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!editor) {
      return;
    }

    const validation = validateIgnoredSender({
      platform,
      identifier: editor.identifier,
      label: editor.label,
    });

    if (!validation.ok) {
      setError(validation.error);
      return;
    }

    const { id } = editor;
    const value = validation.value;

    startTransition(async () => {
      const result = id
        ? await updateIgnoredSenderAction({ id, ...value })
        : await createIgnoredSenderAction(value);

      if (!result.ok) {
        setError(result.error);
        return;
      }

      closeEditor();
      router.refresh();
    });
  }

  function handleDelete() {
    if (!editor?.id) {
      return;
    }

    const address = editor.label
      ? `${editor.label}: ${editor.identifier}`
      : editor.identifier;

    if (
      !window.confirm(
        `Убрать «${address}» из списка исключений? Сообщения с этого адреса снова будут приходить в drafta.`,
      )
    ) {
      return;
    }

    const { id } = editor;

    startTransition(async () => {
      const result = await deleteIgnoredSenderAction({ id });

      if (!result.ok) {
        setError(result.error);
        return;
      }

      closeEditor();
      router.refresh();
    });
  }

  return (
    <div className={setStyles.ignoredSenders}>
      <span className={setStyles.ignoredSendersTitle}>{copy.title}</span>

      <div className={setStyles.ignoredSendersChips}>
        {entries.map((entry) => (
          <span key={entry.id} className={setStyles.ignoredSenderChip}>
            {chipText(entry)}
            <button
              type="button"
              className={setStyles.ignoredSenderChipEdit}
              aria-label={`Изменить исключение «${chipText(entry)}»`}
              title="Изменить"
              disabled={isPending}
              onClick={() => openExisting(entry)}
            >
              <PencilIcon />
            </button>
          </span>
        ))}

        <button
          type="button"
          className={setStyles.ignoredSenderAdd}
          disabled={isPending}
          onClick={openNew}
        >
          <PlusIcon size={12} />
          {copy.add}
        </button>
      </div>

      <p className={setStyles.channelStub}>
        {entries.length > 0 ? copy.hint : copy.empty}
      </p>

      {error && !editor ? (
        <p className={setStyles.formError} role="alert">
          {error}
        </p>
      ) : null}

      {editor ? (
        <div
          className={setStyles.editorBackdrop}
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !isPending) {
              closeEditor();
            }
          }}
        >
          <section
            className={`${setStyles.editorDialog} ${setStyles.editorDialogCompact}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
          >
            <form className={setStyles.editorForm} onSubmit={handleSave}>
              <div className={setStyles.editorHeader}>
                <div>
                  <h2 id={titleId}>
                    {editor.id ? "Изменение исключения" : "Новое исключение"}
                  </h2>
                  <p>
                    Имя видно только вам — по нему вы поймёте, чей это адрес.
                    Сообщения с него в drafta не попадут.
                  </p>
                </div>
                <button
                  type="button"
                  className={`${uiStyles.button} ${uiStyles.buttonGhost}`}
                  onClick={closeEditor}
                  disabled={isPending}
                  aria-label="Закрыть редактор"
                >
                  ✕
                </button>
              </div>

              <label className={setStyles.editorNameField}>
                Имя
                <input
                  type="text"
                  value={editor.label}
                  onChange={(event) =>
                    setEditor({ ...editor, label: event.target.value })
                  }
                  placeholder="например, Анна"
                  maxLength={MAX_IGNORED_SENDER_LABEL_LENGTH}
                  autoFocus
                />
              </label>

              <label className={setStyles.editorNameField}>
                {copy.field}
                <input
                  type={platform === "whatsapp" ? "tel" : "text"}
                  inputMode={platform === "whatsapp" ? "tel" : "text"}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  value={editor.identifier}
                  onChange={(event) =>
                    setEditor({ ...editor, identifier: event.target.value })
                  }
                  placeholder={copy.placeholder}
                />
              </label>

              {error ? (
                <p className={setStyles.formError} role="alert">
                  {error}
                </p>
              ) : null}

              <div className={setStyles.editorActions}>
                {editor.id ? (
                  <button
                    type="button"
                    className={`${uiStyles.button} ${uiStyles.buttonSecondary} ${uiStyles.buttonDanger}`}
                    onClick={handleDelete}
                    disabled={isPending}
                  >
                    Удалить
                  </button>
                ) : (
                  <span />
                )}
                <div>
                  <button
                    type="button"
                    className={`${uiStyles.button} ${uiStyles.buttonSecondary}`}
                    onClick={closeEditor}
                    disabled={isPending}
                  >
                    Отмена
                  </button>
                  <button
                    type="submit"
                    className={`${uiStyles.button} ${uiStyles.buttonPrimary}`}
                    disabled={isPending}
                  >
                    {isPending ? "Сохранение…" : "Сохранить"}
                  </button>
                </div>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </div>
  );
}
