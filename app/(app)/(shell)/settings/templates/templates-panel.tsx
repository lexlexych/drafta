"use client";

/**
 * Раздел «Настройки → Шаблоны ответов».
 *
 * Устроен как «База знаний» рядом (`../knowledge/knowledge-base-panel.tsx`):
 * список строк + модальный редактор поверх него. Отличий два, и оба идут от
 * сути шаблона:
 *
 *   1. вместо одного переключателя активности — два, для переписки и для
 *      комментариев, и живут они в редакторе, а не в строке списка: в списке
 *      тип показывается значками, потому что читать его приходится чаще, чем
 *      менять;
 *   2. вместо пары «редактор + предпросмотр» — вкладки языков и одно поле:
 *      шаблон отправляется дословно, это не markdown, и превью показывать
 *      нечего.
 */

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import {
  TEMPLATE_LANGUAGES,
  nextTemplateBodyKey,
  parseTemplateBodyKey,
  renumberTemplateBodyKeys,
  sortTemplateBodyKeys,
  templateBodyKeyLabel,
  templateBodyKeyShortLabel,
  type TemplateLanguage,
} from "@/lib/i18n/template-languages";
import {
  MAX_TEMPLATE_NAME_LENGTH,
  validateTemplate,
  type TemplateBodies,
} from "@/lib/templates/validation";

import { useActivityTransition } from "../../_components/activity";
import { CommentsIcon, MessagesIcon, PlusIcon } from "../../_components/icons";
import uiStyles from "../../_components/ui.module.css";
import styles from "../settings.module.css";
import {
  createReplyTemplateAction,
  deleteReplyTemplateAction,
  updateReplyTemplateAction,
} from "./actions";

export type ReplyTemplateListItem = {
  id: string;
  name: string;
  bodies: TemplateBodies;
  isEnabledForMessages: boolean;
  isEnabledForComments: boolean;
  updated_at: string;
};

type EditorState = {
  id: string | null;
  name: string;
  bodies: TemplateBodies;
  /** Ключи `bodies` в порядке вкладок: это язык + номер варианта, не язык. */
  bodyKeys: string[];
  activeKey: string;
  isEnabledForMessages: boolean;
  isEnabledForComments: boolean;
};

function formatUpdatedAt(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.valueOf())) {
    return "дата обновления неизвестна";
  }

  return `обновлён ${new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Berlin",
  }).format(date)}`;
}

export function ReplyTemplatesPanel({
  templates,
  workspaceLanguage,
}: {
  templates: ReplyTemplateListItem[];
  /** Язык из «Настройки → Аккаунт»: единственная вкладка нового шаблона. */
  workspaceLanguage: TemplateLanguage;
}) {
  const router = useRouter();
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useActivityTransition("Сохраняем шаблон…");

  function refreshAfterSuccess() {
    setError(null);
    setEditor(null);
    router.refresh();
  }

  function openTemplate(template: ReplyTemplateListItem) {
    const bodyKeys = sortTemplateBodyKeys(
      Object.keys(template.bodies),
      workspaceLanguage,
    );
    // Шаблон без единого текста база не хранит, но пустой список сломал бы
    // вкладки — подставляем язык воркспейса.
    const resolved = bodyKeys.length > 0 ? bodyKeys : [workspaceLanguage];

    setError(null);
    setEditor({
      id: template.id,
      name: template.name,
      bodies: { ...template.bodies },
      bodyKeys: resolved,
      activeKey: resolved[0]!,
      isEnabledForMessages: template.isEnabledForMessages,
      isEnabledForComments: template.isEnabledForComments,
    });
  }

  function openNewTemplate() {
    setError(null);
    setEditor({
      id: null,
      name: "",
      bodies: { [workspaceLanguage]: "" },
      bodyKeys: [workspaceLanguage],
      activeKey: workspaceLanguage,
      isEnabledForMessages: true,
      isEnabledForComments: false,
    });
  }

  function patchEditor(patch: Partial<EditorState>) {
    setEditor((state) => (state ? { ...state, ...patch } : state));
  }

  function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!editor) {
      return;
    }

    const validation = validateTemplate({
      name: editor.name,
      bodies: editor.bodies,
      isEnabledForMessages: editor.isEnabledForMessages,
      isEnabledForComments: editor.isEnabledForComments,
    });

    if (!validation.ok) {
      setError(validation.error);
      return;
    }

    const { id } = editor;

    startTransition(async () => {
      const result = id
        ? await updateReplyTemplateAction({ id, ...validation.value })
        : await createReplyTemplateAction(validation.value);

      if (!result.ok) {
        setError(result.error);
        return;
      }

      refreshAfterSuccess();
    });
  }

  function handleDelete() {
    if (!editor?.id) {
      return;
    }
    if (
      !window.confirm(
        `Удалить шаблон «${editor.name}»? Это действие нельзя отменить.`,
      )
    ) {
      return;
    }

    const { id } = editor;

    startTransition(async () => {
      const result = await deleteReplyTemplateAction({ id });

      if (!result.ok) {
        setError(result.error);
        return;
      }

      refreshAfterSuccess();
    });
  }

  return (
    <>
      {error && !editor ? (
        <p className={styles.formError} role="alert">
          {error}
        </p>
      ) : null}

      <div className={`${uiStyles.card} ${styles.knowledgeCard}`}>
        {templates.length === 0 ? (
          <div className={styles.knowledgeEmpty}>
            <b>Шаблонов пока нет</b>
            <span>
              Создайте первый: название, тексты на нужных языках и типы, где
              шаблон будет предлагаться.
            </span>
          </div>
        ) : (
          templates.map((template) => (
            <div key={template.id} className={styles.templateRow}>
              <button
                type="button"
                className={styles.knowledgeName}
                onClick={() => openTemplate(template)}
                disabled={isPending}
              >
                {template.name}
              </button>
              <span className={styles.knowledgeDate}>
                {formatUpdatedAt(template.updated_at)}
              </span>
              <span className={styles.templateTypes}>
                {template.isEnabledForComments ? (
                  <span className={styles.templateType} title="Активен для комментариев">
                    <CommentsIcon size={16} />
                    <span className={styles.visuallyHidden}>
                      Активен для комментариев
                    </span>
                  </span>
                ) : null}
                {template.isEnabledForMessages ? (
                  <span className={styles.templateType} title="Активен для сообщений">
                    <MessagesIcon size={16} />
                    <span className={styles.visuallyHidden}>
                      Активен для сообщений
                    </span>
                  </span>
                ) : null}
              </span>
            </div>
          ))
        )}
      </div>

      <div className={styles.knowledgeButtons}>
        <button
          type="button"
          className={`${uiStyles.button} ${uiStyles.buttonPrimary}`}
          onClick={openNewTemplate}
        >
          + Новый шаблон
        </button>
      </div>

      {editor ? (
        <div
          className={styles.editorBackdrop}
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !isPending) {
              setEditor(null);
              setError(null);
            }
          }}
        >
          <section
            className={`${styles.editorDialog} ${styles.editorDialogNarrow}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="template-editor-title"
          >
            <form className={styles.editorForm} onSubmit={handleSave}>
              <div className={styles.editorHeader}>
                <div>
                  <h2 id="template-editor-title">
                    {editor.id ? "Редактирование шаблона" : "Новый шаблон"}
                  </h2>
                  <p>
                    Название видит только команда — по нему оператор выбирает
                    шаблон в поле ответа. Текст уходит клиенту дословно.
                  </p>
                </div>
                <button
                  type="button"
                  className={`${uiStyles.button} ${uiStyles.buttonGhost}`}
                  onClick={() => {
                    setEditor(null);
                    setError(null);
                  }}
                  disabled={isPending}
                  aria-label="Закрыть редактор"
                >
                  ✕
                </button>
              </div>

              <label className={styles.editorNameField}>
                Название
                <input
                  type="text"
                  value={editor.name}
                  onChange={(event) => patchEditor({ name: event.target.value })}
                  placeholder="например, Сроки доставки"
                  maxLength={MAX_TEMPLATE_NAME_LENGTH}
                  autoFocus
                />
              </label>

              <div className={styles.templateSurfaces}>
                <SurfaceToggle
                  label="Сообщения"
                  checked={editor.isEnabledForMessages}
                  disabled={isPending}
                  onToggle={() =>
                    patchEditor({
                      isEnabledForMessages: !editor.isEnabledForMessages,
                    })
                  }
                />
                <SurfaceToggle
                  label="Комментарии"
                  checked={editor.isEnabledForComments}
                  disabled={isPending}
                  onToggle={() =>
                    patchEditor({
                      isEnabledForComments: !editor.isEnabledForComments,
                    })
                  }
                />
              </div>

              <LanguageTabs
                bodyKeys={editor.bodyKeys}
                activeKey={editor.activeKey}
                disabled={isPending}
                onSelect={(key) => patchEditor({ activeKey: key })}
                onAdd={(language) => {
                  // Язык, который уже есть, добавляется следующим вариантом:
                  // `ru` → `ru-2`. Новая вкладка сразу активна — текст набирают
                  // именно на ней.
                  const key = nextTemplateBodyKey(language, editor.bodyKeys);

                  patchEditor({
                    bodyKeys: [...editor.bodyKeys, key],
                    bodies: { ...editor.bodies, [key]: "" },
                    activeKey: key,
                  });
                }}
                onRemove={(key) => {
                  if (editor.bodyKeys.length === 1) {
                    return;
                  }
                  if (
                    editor.bodies[key]?.trim() &&
                    !window.confirm(
                      `Удалить текст «${templateBodyKeyLabel(key)}»?`,
                    )
                  ) {
                    return;
                  }

                  const kept = editor.bodyKeys.filter((entry) => entry !== key);
                  const bodies: TemplateBodies = {};
                  for (const entry of kept) {
                    bodies[entry] = editor.bodies[entry] ?? "";
                  }

                  // Номера закрываются сразу, а не при сохранении: иначе после
                  // удаления `ru-2` из трёх на вкладках остался бы `ru-3` без
                  // второго, и номер прыгнул бы уже после «Сохранить».
                  const renumbered = renumberTemplateBodyKeys(bodies);
                  const renumberedKeys = Object.keys(renumbered);
                  const activeIndex = kept.indexOf(editor.activeKey);

                  patchEditor({
                    bodyKeys: renumberedKeys,
                    bodies: renumbered,
                    activeKey:
                      activeIndex === -1
                        ? renumberedKeys[0]!
                        : renumberedKeys[activeIndex]!,
                  });
                }}
              />

              <label className={styles.templateBodyField}>
                <span className={styles.visuallyHidden}>
                  Текст шаблона: {templateBodyKeyLabel(editor.activeKey)}
                </span>
                <textarea
                  value={editor.bodies[editor.activeKey] ?? ""}
                  onChange={(event) =>
                    patchEditor({
                      bodies: {
                        ...editor.bodies,
                        [editor.activeKey]: event.target.value,
                      },
                    })
                  }
                  placeholder="Текст, который оператор отправит клиенту на этом языке."
                  spellCheck
                />
              </label>

              {error ? (
                <p className={styles.formError} role="alert">
                  {error}
                </p>
              ) : null}

              <div className={styles.editorActions}>
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
                    onClick={() => {
                      setEditor(null);
                      setError(null);
                    }}
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
    </>
  );
}

function SurfaceToggle({
  label,
  checked,
  disabled,
  onToggle,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <span className={styles.templateSurface}>
      <button
        type="button"
        className={uiStyles.switch}
        role="switch"
        aria-checked={checked}
        aria-label={`${checked ? "Деактивировать" : "Активировать"} шаблон для: ${label}`}
        disabled={disabled}
        onClick={onToggle}
      />
      <span>{label}</span>
    </span>
  );
}

/**
 * Вкладки текстов шаблона. Вкладка — это язык плюс номер варианта, поэтому в
 * выпадающем списке остаются и уже добавленные языки: выбрать русский второй
 * раз — значит завести ещё одну формулировку на русском (`ru-2`).
 *
 * Подпись вкладки — сам ключ (`ru`, `ru-2`): вкладок бывает с десяток, и полные
 * названия съедали бы строку. Полное имя языка остаётся в выпадающем списке и в
 * подсказке вкладки.
 */
function LanguageTabs({
  bodyKeys,
  activeKey,
  disabled,
  onSelect,
  onAdd,
  onRemove,
}: {
  bodyKeys: string[];
  activeKey: string;
  disabled: boolean;
  onSelect: (key: string) => void;
  onAdd: (language: TemplateLanguage) => void;
  onRemove: (key: string) => void;
}) {
  // Список не фильтруется: у каждого языка показываем номер варианта, который
  // получится при выборе, — чтобы было видно, что добавится ещё один текст, а
  // не откроется существующий.
  const options = useMemo(
    () =>
      TEMPLATE_LANGUAGES.map((entry) => {
        const taken = bodyKeys.filter(
          (key) => parseTemplateBodyKey(key)?.language === entry.value,
        ).length;

        return {
          value: entry.value,
          label: taken === 0 ? entry.label : `${entry.label} — вариант ${taken + 1}`,
        };
      }),
    [bodyKeys],
  );

  return (
    <div className={styles.langTabs}>
      <div role="tablist" aria-label="Тексты шаблона" className={styles.langTabList}>
        {bodyKeys.map((key) => {
          const isActive = key === activeKey;
          const label = templateBodyKeyLabel(key);

          return (
            <span key={key} className={styles.langTab} data-active={isActive}>
              <button
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-label={label}
                title={label}
                disabled={disabled}
                onClick={() => onSelect(key)}
              >
                {templateBodyKeyShortLabel(key)}
              </button>
              {bodyKeys.length > 1 ? (
                <button
                  type="button"
                  className={styles.langTabRemove}
                  aria-label={`Удалить текст: ${label}`}
                  title="Удалить текст"
                  disabled={disabled}
                  onClick={() => onRemove(key)}
                >
                  ✕
                </button>
              ) : null}
            </span>
          );
        })}
      </div>

      <label className={styles.langTabAdd}>
        <span className={styles.langTabAddIcon} aria-hidden="true">
          <PlusIcon size={14} />
        </span>
        <span className={styles.visuallyHidden}>Добавить язык</span>
        <select
          aria-label="Добавить язык"
          value=""
          disabled={disabled}
          onChange={(event) => {
            if (event.target.value) {
              onAdd(event.target.value as TemplateLanguage);
            }
          }}
        >
          <option value="">Добавить язык…</option>
          {options.map((entry) => (
            <option key={entry.value} value={entry.value}>
              {entry.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
