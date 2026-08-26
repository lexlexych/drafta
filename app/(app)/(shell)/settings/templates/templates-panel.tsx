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
  sortTemplateLanguages,
  templateLanguageLabel,
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
  languages: string[];
  activeLanguage: string;
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
    const languages = sortTemplateLanguages(
      Object.keys(template.bodies),
      workspaceLanguage,
    );
    // Шаблон без единого языка база не хранит, но пустой список сломал бы
    // вкладки — подставляем язык воркспейса.
    const resolved = languages.length > 0 ? languages : [workspaceLanguage];

    setError(null);
    setEditor({
      id: template.id,
      name: template.name,
      bodies: { ...template.bodies },
      languages: resolved,
      activeLanguage: resolved[0]!,
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
      languages: [workspaceLanguage],
      activeLanguage: workspaceLanguage,
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
                languages={editor.languages}
                activeLanguage={editor.activeLanguage}
                disabled={isPending}
                onSelect={(language) => patchEditor({ activeLanguage: language })}
                onAdd={(language) =>
                  patchEditor({
                    languages: [...editor.languages, language],
                    bodies: { ...editor.bodies, [language]: "" },
                    activeLanguage: language,
                  })
                }
                onRemove={(language) => {
                  if (editor.languages.length === 1) {
                    return;
                  }
                  if (
                    editor.bodies[language]?.trim() &&
                    !window.confirm(
                      `Удалить текст на языке «${templateLanguageLabel(language)}»?`,
                    )
                  ) {
                    return;
                  }

                  const languages = editor.languages.filter(
                    (entry) => entry !== language,
                  );
                  const bodies = { ...editor.bodies };
                  delete bodies[language];

                  patchEditor({
                    languages,
                    bodies,
                    activeLanguage:
                      editor.activeLanguage === language
                        ? languages[0]!
                        : editor.activeLanguage,
                  });
                }}
              />

              <label className={styles.templateBodyField}>
                <span className={styles.visuallyHidden}>
                  Текст шаблона: {templateLanguageLabel(editor.activeLanguage)}
                </span>
                <textarea
                  value={editor.bodies[editor.activeLanguage] ?? ""}
                  onChange={(event) =>
                    patchEditor({
                      bodies: {
                        ...editor.bodies,
                        [editor.activeLanguage]: event.target.value,
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
 * Вкладки языков шаблона. Языки не выбираются заранее списком, а добавляются по
 * одному: у шаблона их обычно два-три, а двадцать вкладок сразу только прятали
 * бы те, что действительно заполнены.
 */
function LanguageTabs({
  languages,
  activeLanguage,
  disabled,
  onSelect,
  onAdd,
  onRemove,
}: {
  languages: string[];
  activeLanguage: string;
  disabled: boolean;
  onSelect: (language: string) => void;
  onAdd: (language: string) => void;
  onRemove: (language: string) => void;
}) {
  const available = useMemo(
    () => TEMPLATE_LANGUAGES.filter((entry) => !languages.includes(entry.value)),
    [languages],
  );

  return (
    <div className={styles.langTabs}>
      <div role="tablist" aria-label="Языки шаблона" className={styles.langTabList}>
        {languages.map((language) => {
          const isActive = language === activeLanguage;

          return (
            <span key={language} className={styles.langTab} data-active={isActive}>
              <button
                type="button"
                role="tab"
                aria-selected={isActive}
                disabled={disabled}
                onClick={() => onSelect(language)}
              >
                {templateLanguageLabel(language)}
              </button>
              {languages.length > 1 ? (
                <button
                  type="button"
                  className={styles.langTabRemove}
                  aria-label={`Удалить язык: ${templateLanguageLabel(language)}`}
                  title="Удалить язык"
                  disabled={disabled}
                  onClick={() => onRemove(language)}
                >
                  ✕
                </button>
              ) : null}
            </span>
          );
        })}
      </div>

      {available.length > 0 ? (
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
                onAdd(event.target.value);
              }
            }}
          >
            <option value="">Добавить язык…</option>
            {available.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </div>
  );
}
