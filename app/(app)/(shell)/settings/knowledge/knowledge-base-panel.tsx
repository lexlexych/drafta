"use client";

import { useId, useMemo, useState, useTransition, type ChangeEvent, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import {
  getKnowledgeBaseUsage,
  KNOWLEDGE_BASE_TOKEN_BUDGET,
} from "@/lib/ai/knowledge-base";
import {
  MAX_KNOWLEDGE_FILE_BYTES,
  validateMarkdownFile,
} from "@/lib/knowledge-base/files";

import uiStyles from "../../_components/ui.module.css";
import styles from "../settings.module.css";
import {
  createKnowledgeFileAction,
  deleteKnowledgeFileAction,
  setKnowledgeFileEnabledAction,
  updateKnowledgeFileAction,
} from "./actions";

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
  const uploadInputId = useId();
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
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

  function openFile(file: KnowledgeFileListItem) {
    setError(null);
    setEditor({ id: file.id, name: file.name, content: file.content });
  }

  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";

    if (!file) {
      return;
    }
    if (file.size > MAX_KNOWLEDGE_FILE_BYTES) {
      setError("Файл слишком большой. Максимальный размер — 512 КБ.");
      return;
    }

    try {
      const content = await file.text();
      const validation = validateMarkdownFile(file.name, content);

      if (!validation.ok) {
        setError(validation.error);
        return;
      }

      setError(null);
      setEditor({ id: null, name: validation.name, content: validation.content });
    } catch {
      setError("Не удалось прочитать файл.");
    }
  }

  function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!editor) {
      return;
    }

    const validation = validateMarkdownFile(editor.name, editor.content);

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
    if (!window.confirm(`Удалить «${editor.name}»? Это действие нельзя отменить.`)) {
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
            <b>База знаний пока пуста</b>
            <span>Создайте файл в браузере или загрузите готовый Markdown.</span>
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
                onClick={() => openFile(file)}
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
                aria-label={`${file.is_enabled ? "Деактивировать" : "Активировать"} ${file.name}`}
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
            <span>{usage.enabledFileCount} активных файлов</span>
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
              Бюджет превышен. В AI-промпт попадут только первые целые файлы,
              которые помещаются в {formatTokens(KNOWLEDGE_BASE_TOKEN_BUDGET)} токенов.
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
          + Новый файл
        </button>
        <label
          className={`${uiStyles.button} ${uiStyles.buttonSecondary}`}
          htmlFor={uploadInputId}
        >
          Загрузить .md
        </label>
        <input
          id={uploadInputId}
          className={styles.visuallyHidden}
          type="file"
          accept=".md,text/markdown,text/plain"
          onChange={handleUpload}
        />
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
                    {editor.id ? "Редактирование файла" : "Новый файл"}
                  </h2>
                  <p>Markdown сохраняется прямо в базе данных workspace.</p>
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
                Имя файла
                <input
                  type="text"
                  value={editor.name}
                  onChange={(event) =>
                    setEditor((state) =>
                      state ? { ...state, name: event.target.value } : state,
                    )
                  }
                  placeholder="например, 01-описание.md"
                  maxLength={120}
                  autoFocus
                />
              </label>

              <div className={styles.editorColumns}>
                <div className={styles.editorColumn}>
                  <span className={styles.editorColumnTitle}>Редактор</span>
                  <textarea
                    aria-label="Содержимое Markdown"
                    value={editor.content}
                    onChange={(event) =>
                      setEditor((state) =>
                        state ? { ...state, content: event.target.value } : state,
                      )
                    }
                    placeholder="# Заголовок\n\nДобавьте информацию, которую AI должен учитывать в ответах."
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
