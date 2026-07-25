"use client";

import {
  useState,
  useTransition,
  type DragEvent,
  type FormEvent,
} from "react";
import { useRouter } from "next/navigation";

import type { CategoryRow } from "@/lib/db/categories";

import { GripIcon, LockIcon } from "../../_components/icons";
import uiStyles from "../../_components/ui.module.css";
import styles from "../settings.module.css";
import {
  createCategoryAction,
  deleteCategoryAction,
  reorderCategoriesAction,
  updateCategoryAction,
} from "./actions";

export type CategoryListItem = CategoryRow;

export type CategoryChannelOption = {
  id: string;
  name: string;
};

type EditorState = {
  id: string | null;
  name: string;
  description: string;
  draftInstruction: string;
  channelConnectionIds: string[];
  skipDraft: boolean;
  isDefault: boolean;
};

const CATEGORY_COLOR_VARS = [
  "--cat-1",
  "--cat-2",
  "--cat-3",
  "--cat-4",
  "--cat-5",
];

function editorFromCategory(category: CategoryListItem): EditorState {
  return {
    id: category.id,
    name: category.name,
    description: category.description,
    draftInstruction: category.draft_instruction ?? "",
    channelConnectionIds: category.channel_connection_ids,
    skipDraft: category.skip_draft,
    isDefault: category.is_default,
  };
}

function emptyEditor(): EditorState {
  return {
    id: null,
    name: "",
    description: "",
    draftInstruction: "",
    channelConnectionIds: [],
    skipDraft: false,
    isDefault: false,
  };
}

function moveBefore(
  categories: CategoryListItem[],
  sourceId: string,
  targetId: string,
): CategoryListItem[] {
  const regular = categories.filter((category) => !category.is_default);
  const fallback = categories.find((category) => category.is_default);
  const sourceIndex = regular.findIndex((category) => category.id === sourceId);
  const targetIndex = regular.findIndex((category) => category.id === targetId);

  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) {
    return categories;
  }

  const reordered = [...regular];
  const [source] = reordered.splice(sourceIndex, 1);
  const adjustedTargetIndex = reordered.findIndex(
    (category) => category.id === targetId,
  );
  reordered.splice(adjustedTargetIndex, 0, source);

  return fallback ? [...reordered, fallback] : reordered;
}

function categoryScopeLabel(
  category: CategoryListItem,
  channels: CategoryChannelOption[],
): string {
  const channelNames = category.channel_connection_ids
    .map((id) => channels.find((channel) => channel.id === id)?.name)
    .filter((name): name is string => Boolean(name));
  const scope = channelNames.length > 0 ? channelNames.join(", ") : "все";

  return `каналы: ${scope}`;
}

export function CategoriesPanel({
  categories,
  channels,
}: {
  categories: CategoryListItem[];
  channels: CategoryChannelOption[];
}) {
  const router = useRouter();
  const [orderedCategories, setOrderedCategories] = useState(categories);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function closeEditor() {
    setEditor(null);
    setError(null);
  }

  function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!editor) {
      return;
    }

    startTransition(async () => {
      const input = {
        name: editor.name,
        description: editor.description,
        draftInstruction: editor.draftInstruction,
        channelConnectionIds: editor.isDefault
          ? []
          : editor.channelConnectionIds,
        skipDraft: editor.skipDraft,
      };
      const result = editor.id
        ? await updateCategoryAction({
            ...input,
            id: editor.id,
            isDefault: editor.isDefault,
          })
        : await createCategoryAction(input);

      if (!result.ok) {
        setError(result.error);
        return;
      }

      closeEditor();
      router.refresh();
    });
  }

  function handleDelete() {
    if (!editor?.id || editor.isDefault) {
      return;
    }
    if (
      !window.confirm(
        `Удалить категорию «${editor.name}»? Присвоенные сообщения останутся без категории.`,
      )
    ) {
      return;
    }

    startTransition(async () => {
      const result = await deleteCategoryAction({ id: editor.id! });

      if (!result.ok) {
        setError(result.error);
        return;
      }

      closeEditor();
      router.refresh();
    });
  }

  function handleDrop(event: DragEvent<HTMLElement>, targetId: string) {
    event.preventDefault();

    if (!draggedId || draggedId === targetId || isPending) {
      setDraggedId(null);
      return;
    }

    const previous = orderedCategories;
    const next = moveBefore(previous, draggedId, targetId);
    const ids = next
      .filter((category) => !category.is_default)
      .map((category) => category.id);

    setDraggedId(null);
    setError(null);
    setOrderedCategories(next);
    startTransition(async () => {
      const result = await reorderCategoriesAction({ ids });

      if (!result.ok) {
        setOrderedCategories(previous);
        setError(result.error);
        return;
      }

      router.refresh();
    });
  }

  function toggleChannel(channelId: string) {
    setEditor((current) => {
      if (!current || current.isDefault) {
        return current;
      }

      const isSelected = current.channelConnectionIds.includes(channelId);
      return {
        ...current,
        channelConnectionIds: isSelected
          ? current.channelConnectionIds.filter((id) => id !== channelId)
          : [...current.channelConnectionIds, channelId],
      };
    });
  }

  return (
    <>
      {error && !editor ? (
        <p className={styles.formError} role="alert">
          {error}
        </p>
      ) : null}

      <div className={uiStyles.card}>
        {orderedCategories.map((category, index) => (
          <div
            key={category.id}
            className={`${styles.categoryRow} ${
              category.is_default ? styles.categoryDefault : ""
            }`}
            data-dragging={draggedId === category.id}
            onDragOver={(event) => {
              if (!category.is_default) {
                event.preventDefault();
              }
            }}
            onDrop={(event) => {
              if (!category.is_default) {
                handleDrop(event, category.id);
              }
            }}
          >
            {category.is_default ? (
              <span className={`${styles.grip} ${styles.gripHidden}`}>
                <GripIcon />
              </span>
            ) : (
              <button
                type="button"
                className={styles.gripButton}
                draggable={!isPending}
                disabled={isPending}
                aria-label={`Перетащить категорию «${category.name}»`}
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = "move";
                  setDraggedId(category.id);
                }}
                onDragEnd={() => setDraggedId(null)}
              >
                <GripIcon />
              </button>
            )}
            <span className={`${styles.priority} ${uiStyles.num}`}>
              {category.is_default ? <LockIcon /> : index + 1}
            </span>
            <div className={styles.categoryBody}>
              <b>
                <span
                  className={uiStyles.categoryDot}
                  style={{
                    background: `var(${
                      category.is_default
                        ? "--cat-default"
                        : (CATEGORY_COLOR_VARS[index] ?? "--cat-default")
                    })`,
                  }}
                  aria-hidden="true"
                />
                {category.name}
              </b>
              <div className={styles.categoryChips}>
                <span className={uiStyles.chip}>
                  {categoryScopeLabel(category, channels)}
                </span>
                {category.draft_instruction ? (
                  <span className={uiStyles.chip}>
                    действие: {category.draft_instruction}
                  </span>
                ) : null}
                {category.skip_draft ? (
                  <span className={uiStyles.chip}>без черновиков</span>
                ) : null}
                {category.is_default ? (
                  <span className={uiStyles.chip}>системная</span>
                ) : null}
              </div>
            </div>
            <button
              className={`${uiStyles.button} ${uiStyles.buttonSmall} ${uiStyles.buttonGhost}`}
              disabled={isPending}
              onClick={() => {
                setError(null);
                setEditor(editorFromCategory(category));
              }}
              type="button"
            >
              Изменить
            </button>
          </div>
        ))}
      </div>

      <button
        className={`${uiStyles.button} ${uiStyles.buttonPrimary} ${uiStyles.buttonSelfStart}`}
        disabled={isPending}
        onClick={() => {
          setError(null);
          setEditor(emptyEditor());
        }}
        type="button"
      >
        + Новая категория
      </button>

      {editor ? (
        <div
          className={styles.editorBackdrop}
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !isPending) {
              closeEditor();
            }
          }}
        >
          <section
            className={`${styles.editorDialog} ${styles.categoryDialog}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="category-editor-title"
          >
            <form className={styles.categoryForm} onSubmit={handleSave}>
              <div className={styles.editorHeader}>
                <div>
                  <h2 id="category-editor-title">
                    {editor.id ? "Редактирование категории" : "Новая категория"}
                  </h2>
                  <p>
                    {editor.isDefault
                      ? "Системная категория всегда остаётся последней."
                      : "Первая подходящая категория по порядку получает сообщение. У комментариев категорий нет."}
                  </p>
                </div>
                <button
                  type="button"
                  className={`${uiStyles.button} ${uiStyles.buttonGhost}`}
                  onClick={closeEditor}
                  disabled={isPending}
                  aria-label="Закрыть редактор категории"
                >
                  ✕
                </button>
              </div>

              <div className={styles.categoryFormBody}>
                <label className={styles.categoryField}>
                  Название
                  <input
                    type="text"
                    value={editor.name}
                    onChange={(event) =>
                      setEditor((current) =>
                        current ? { ...current, name: event.target.value } : current,
                      )
                    }
                    placeholder="Например, «Вопрос о цене»"
                    maxLength={120}
                    disabled={editor.isDefault || isPending}
                    autoFocus={!editor.isDefault}
                  />
                </label>

                <label className={styles.categoryField}>
                  Описание-правило
                  <textarea
                    value={editor.description}
                    onChange={(event) =>
                      setEditor((current) =>
                        current
                          ? { ...current, description: event.target.value }
                          : current,
                      )
                    }
                    placeholder="Опишите, какие входящие относятся к этой категории."
                    rows={4}
                    disabled={editor.isDefault || isPending}
                  />
                  <span>
                    AI использует этот текст, чтобы выбрать первую подходящую
                    категорию.
                  </span>
                </label>

                <label className={styles.categoryField}>
                  Действие для черновика (необязательно)
                  <textarea
                    value={editor.draftInstruction}
                    onChange={(event) =>
                      setEditor((current) =>
                        current
                          ? {
                              ...current,
                              draftInstruction: event.target.value,
                            }
                          : current,
                      )
                    }
                    placeholder="Например, предложить замену и извиниться."
                    rows={3}
                    disabled={isPending}
                  />
                </label>

                {!editor.isDefault ? (
                  <fieldset className={styles.categoryFieldset}>
                    <legend>Каналы</legend>
                    <span className={styles.categoryFieldHint}>
                      Ничего не выбрано — категория работает во всех каналах.
                    </span>
                    {channels.length > 0 ? (
                      channels.map((channel) => (
                        <label key={channel.id}>
                          <input
                            type="checkbox"
                            checked={editor.channelConnectionIds.includes(
                              channel.id,
                            )}
                            onChange={() => toggleChannel(channel.id)}
                            disabled={isPending}
                          />
                          {channel.name}
                        </label>
                      ))
                    ) : (
                      <span className={styles.categoryFieldHint}>
                        Подключённых каналов пока нет.
                      </span>
                    )}
                  </fieldset>
                ) : (
                  <p className={styles.categoryLockedNote}>
                    Каналы зафиксированы: категория работает во всех каналах.
                  </p>
                )}

                <label className={styles.categorySkipDraft}>
                  <span>
                    <b>Не создавать черновиков</b>
                    <small>
                      Входящее получит категорию, но генерация ответа остановится.
                    </small>
                  </span>
                  <input
                    type="checkbox"
                    checked={editor.skipDraft}
                    onChange={(event) =>
                      setEditor((current) =>
                        current
                          ? { ...current, skipDraft: event.target.checked }
                          : current,
                      )
                    }
                    disabled={isPending}
                  />
                </label>

                {error ? (
                  <p className={styles.formError} role="alert">
                    {error}
                  </p>
                ) : null}
              </div>

              <div className={styles.editorActions}>
                {editor.id && !editor.isDefault ? (
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
    </>
  );
}
