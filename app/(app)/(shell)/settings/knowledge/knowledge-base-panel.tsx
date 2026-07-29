"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import {
  getKnowledgeBaseUsage,
  KNOWLEDGE_BASE_TOKEN_BUDGET,
} from "@/lib/ai/knowledge-base";
import { validateCategory } from "@/lib/knowledge-base/files";

import uiStyles from "../../_components/ui.module.css";
import styles from "../settings.module.css";
import {
  createKnowledgeFileAction,
  deleteKnowledgeFileAction,
  setKnowledgeFileEnabledAction,
  updateKnowledgeFileAction,
} from "./actions";
import { useActivityTransition } from "../../_components/activity";

export type KnowledgeFileListItem = {
  id: string;
  name: string;
  content: string;
  sort_order: number;
  is_enabled: boolean;
  updated_at: string;
};

type EditorState = {
  id: string | null;
  name: string;
  content: string;
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

function formatTokens(value: number): string {
  return new Intl.NumberFormat("ru-RU").format(value);
}

export function KnowledgeBasePanel({
  files,
}: {
  files: KnowledgeFileListItem[];
}) {
  const router = useRouter();
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useActivityTransition("Сохраняем категорию…");
  const usage = useMemo(() => getKnowledgeBaseUsage(files), [files]);
  const progress = Math.min(
    100,
    Math.round((usage.enabledTokenCount / usage.tokenBudget) * 100),
  );

  function refreshAfterSuccess() {
    setError(null);
    setEditor(null);
    router.refresh();
  }

  function openCategory(file: KnowledgeFileListItem) {
    setError(null);
    setEditor({ id: file.id, name: file.name, content: file.content });
  }

  function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!editor) {
      return;
    }

    const validation = validateCategory(editor.name, editor.content);

    if (!validation.ok) {
      setError(validation.error);
      return;
    }

    startTransition(async () => {
      const result = editor.id
        ? await updateKnowledgeFileAction({
            id: editor.id,
            name: validation.name,
            content: validation.content,
          })
        : await createKnowledgeFileAction({
            name: validation.name,
            content: validation.content,
          });

      if (!result.ok) {
        setError(result.error);
        return;
      }

      refreshAfterSuccess();
    });
  }

  function handleToggle(file: KnowledgeFileListItem) {
    setError(null);
    startTransition(async () => {
      const result = await setKnowledgeFileEnabledAction({
        id: file.id,
        isEnabled: !file.is_enabled,
      });

      if (!result.ok) {
        setError(result.error);
        return;
      }

      router.refresh();
    });
  }

  function handleDelete() {
    if (!editor?.id) {
      return;
    }
    if (
      !window.confirm(
        `Удалить категорию «${editor.name}»? Это действие нельзя отменить.`,
      )
    ) {
      return;
    }

    startTransition(async () => {
      const result = await deleteKnowledgeFileAction({ id: editor.id! });

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
        {files.length === 0 ? (
          <div className={styles.knowledgeEmpty}>
            <b>Категорий пока нет</b>
            <span>
              Создайте первую: название темы и текст, из которого AI будет брать
              факты для ответов.
            </span>
          </div>
        ) : (
          files.map((file) => (
            <div
              key={file.id}
              className={styles.knowledgeRow}
              data-disabled={!file.is_enabled}
            >
              <button
                type="button"
                className={styles.knowledgeName}
                onClick={() => openCategory(file)}
                disabled={isPending}
              >
                {file.name}
              </button>
              <span className={styles.knowledgeDate}>
                {formatUpdatedAt(file.updated_at)}
              </span>
              <button
                type="button"
                className={uiStyles.switch}
                role="switch"
                aria-checked={file.is_enabled}
                aria-label={`${file.is_enabled ? "Деактивировать" : "Активировать"} категорию ${file.name}`}
                onClick={() => handleToggle(file)}
                disabled={isPending}
              />
            </div>
          ))
        )}

        <div className={styles.knowledgeBudget}>
          <div className={styles.knowledgeBudgetLabel}>
            <span>
              Бюджет токенов: {formatTokens(usage.enabledTokenCount)} /{" "}
              {formatTokens(usage.tokenBudget)}
            </span>
            <span>{usage.enabledFileCount} активных категорий</span>
          </div>
          <div
            className={styles.knowledgeBudgetBar}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={usage.tokenBudget}
            aria-valuenow={Math.min(usage.enabledTokenCount, usage.tokenBudget)}
          >
            <span style={{ width: `${progress}%` }} data-over={usage.exceedsBudget} />
          </div>
          {usage.exceedsBudget ? (
            <p className={styles.knowledgeWarning} role="alert">
              Бюджет превышен. В AI-промпт попадут только первые целые
              категории, которые помещаются в{" "}
              {formatTokens(KNOWLEDGE_BASE_TOKEN_BUDGET)} токенов.
            </p>
          ) : null}
        </div>
      </div>

      <div className={styles.knowledgeButtons}>
        <button
          type="button"
          className={`${uiStyles.button} ${uiStyles.buttonPrimary}`}
          onClick={() => {
            setError(null);
            setEditor({ id: null, name: "", content: "" });
          }}
        >
          + Новая категория
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
            className={styles.editorDialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="knowledge-editor-title"
          >
            <form className={styles.editorForm} onSubmit={handleSave}>
              <div className={styles.editorHeader}>
                <div>
                  <h2 id="knowledge-editor-title">
                    {editor.id ? "Редактирование категории" : "Новая категория"}
                  </h2>
                  <p>
                    Название — это и есть категория, которую AI назовёт в ответе.
                    Текст ниже он использует как источник фактов по ней.
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
                Категория
                <input
                  type="text"
                  value={editor.name}
                  onChange={(event) =>
                    setEditor((state) =>
                      state ? { ...state, name: event.target.value } : state,
                    )
                  }
                  placeholder="например, Прайс и доставка"
                  maxLength={120}
                  autoFocus
                />
              </label>

              <div className={styles.editorColumns}>
                <div className={styles.editorColumn}>
                  <span className={styles.editorColumnTitle}>Редактор</span>
                  <textarea
                    aria-label="Описание категории"
                    value={editor.content}
                    onChange={(event) =>
                      setEditor((state) =>
                        state ? { ...state, content: event.target.value } : state,
                      )
                    }
                    placeholder="# Заголовок\n\nОпишите, что относится к этой категории, и добавьте факты, на которые AI будет опираться."
                    spellCheck
                  />
                </div>
                <div className={styles.editorColumn}>
                  <span className={styles.editorColumnTitle}>Предпросмотр</span>
                  <div className={styles.markdownPreview}>
                    {editor.content.trim() ? (
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        skipHtml
                        components={{
                          a: ({ children, ...props }) => (
                            <a {...props} target="_blank" rel="noreferrer noopener">
                              {children}
                            </a>
                          ),
                          img: ({ alt }) => (
                            <span className={styles.markdownImagePlaceholder}>
                              Изображение: {alt || "без описания"}
                            </span>
                          ),
                        }}
                      >
                        {editor.content}
                      </ReactMarkdown>
                    ) : (
                      <span className={styles.previewEmpty}>
                        Предпросмотр появится здесь.
                      </span>
                    )}
                  </div>
                </div>
              </div>

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
