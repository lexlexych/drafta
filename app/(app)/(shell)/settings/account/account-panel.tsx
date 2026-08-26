"use client";

/**
 * Раздел «Аккаунт» — мобильный аналог меню пользователя из подвала левого меню
 * (`../../_components/user-menu.tsx`): на узком экране левого меню нет, а
 * значит нет и единственного места, где можно было выйти или переключить
 * workspace.
 *
 * Действия те же самые (`../../workspace-actions.ts`), выход — POST-форма на
 * `/auth/sign-out`, а не клиентский `supabase.auth.signOut()`.
 */

import { useState, type FormEvent } from "react";

import {
  WORKSPACE_LANGUAGES,
  type WorkspaceLanguage,
} from "@/lib/i18n/languages";

import { CheckIcon, LogoutIcon, PlusIcon } from "../../_components/icons";
import uiStyles from "../../_components/ui.module.css";
import { saveWorkspaceLanguageAction } from "./actions";
import {
  createWorkspaceFromShellAction,
  switchWorkspaceAction,
  type WorkspaceActionResult,
} from "../../workspace-actions";
import styles from "../settings.module.css";
import { useActivityTransition } from "../../_components/activity";

export type AccountWorkspaceOption = {
  id: string;
  name: string;
};

export function AccountPanel({
  userName,
  userRole,
  workspaces,
  currentWorkspaceId,
  language,
  canManageLanguage,
}: {
  userName: string;
  userRole: string;
  workspaces: AccountWorkspaceOption[];
  currentWorkspaceId: string;
  language: WorkspaceLanguage;
  canManageLanguage: boolean;
}) {
  const [isCreating, setIsCreating] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useActivityTransition("Обновляем рабочее пространство…");

  function handleSwitch(workspaceId: string) {
    if (workspaceId === currentWorkspaceId) {
      return;
    }

    setError(null);
    startTransition(async () => {
      // Успех действия заканчивается серверным редиректом — тогда оно
      // не возвращает результата.
      const result: WorkspaceActionResult | undefined =
        await switchWorkspaceAction(workspaceId);

      if (result && !result.ok) {
        setError(result.error);
      }
    });
  }

  function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const name = newWorkspaceName.trim();

    if (!name) {
      setError("Введите название рабочего пространства.");
      return;
    }

    setError(null);
    startTransition(async () => {
      const result: WorkspaceActionResult | undefined =
        await createWorkspaceFromShellAction({ name });

      if (result && !result.ok) {
        setError(result.error);
      }
    });
  }

  return (
    <>
      <p className={styles.description}>
        Вы вошли как <b>{userName}</b> · {userRole}.
      </p>

      <LanguageCard
        initialLanguage={language}
        canManage={canManageLanguage}
      />

      <div className={uiStyles.card}>
        <h3>Рабочие пространства</h3>
        {workspaces.map((workspace) => {
          const isCurrent = workspace.id === currentWorkspaceId;

          return (
            <button
              key={workspace.id}
              type="button"
              className={styles.accountRow}
              data-active={isCurrent}
              disabled={isPending || isCurrent}
              onClick={() => handleSwitch(workspace.id)}
            >
              <span className={styles.accountIcon}>
                {isCurrent ? <CheckIcon /> : null}
              </span>
              <span className={styles.accountLabel}>{workspace.name}</span>
              {isCurrent ? (
                <span className={styles.accountHint}>текущее</span>
              ) : null}
            </button>
          );
        })}

        {isCreating ? (
          <form className={styles.accountForm} onSubmit={handleCreate}>
            <input
              aria-label="Название нового рабочего пространства"
              autoFocus
              className={styles.renameInput}
              disabled={isPending}
              onChange={(event) => setNewWorkspaceName(event.target.value)}
              placeholder="Название"
              type="text"
              value={newWorkspaceName}
            />
            <button
              className={`${uiStyles.button} ${uiStyles.buttonPrimary} ${uiStyles.buttonSmall}`}
              disabled={isPending}
              type="submit"
            >
              {isPending ? "Создаём…" : "Создать"}
            </button>
          </form>
        ) : (
          <button
            type="button"
            className={styles.accountRow}
            disabled={isPending}
            onClick={() => {
              setIsCreating(true);
              setError(null);
            }}
          >
            <span className={styles.accountIcon}>
              <PlusIcon />
            </span>
            <span className={styles.accountLabel}>Создать workspace</span>
          </button>
        )}
      </div>

      {error ? (
        <p aria-live="polite" className={styles.formError}>
          {error}
        </p>
      ) : null}

      <form action="/auth/sign-out" method="post">
        <button
          className={`${uiStyles.button} ${uiStyles.buttonSecondary} ${uiStyles.buttonDanger}`}
          type="submit"
        >
          <LogoutIcon /> Выйти
        </button>
      </form>
    </>
  );
}

/**
 * Язык приложения на весь workspace (`workspaces.settings.lang`). Сохраняется
 * сразу по выбору — отдельной кнопки «Сохранить» у одного поля не нужно.
 * Интерфейс пока не переводится: это только сохранённое предпочтение.
 */
function LanguageCard({
  initialLanguage,
  canManage,
}: {
  initialLanguage: WorkspaceLanguage;
  canManage: boolean;
}) {
  const [language, setLanguage] = useState<WorkspaceLanguage>(initialLanguage);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useActivityTransition("Сохраняем язык…");

  function handleChange(next: string) {
    const previous = language;
    // Значения <option> приходят из того же списка, что и тип.
    const value = next as WorkspaceLanguage;

    setLanguage(value);
    setError(null);
    setSaved(false);

    startTransition(async () => {
      const result = await saveWorkspaceLanguageAction(value);

      if (!result.ok) {
        setLanguage(previous);
        setError(result.error);
        return;
      }

      setSaved(true);
    });
  }

  return (
    <div className={`${uiStyles.card} ${uiStyles.cardStack}`}>
      <h3>Язык</h3>
      <div className={uiStyles.field}>
        <label htmlFor="workspace-language">Язык приложения</label>
        <select
          id="workspace-language"
          value={language}
          onChange={(event) => handleChange(event.target.value)}
          disabled={isPending || !canManage}
        >
          {WORKSPACE_LANGUAGES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <span className={styles.fieldHint}>
          {canManage
            ? "Язык общий для всего рабочего пространства."
            : "Менять язык может только владелец рабочего пространства."}
        </span>
      </div>
      <div aria-live="polite">
        {error ? (
          <p className={styles.formError} role="alert">
            {error}
          </p>
        ) : saved ? (
          <p className={styles.formSuccess} role="status">
            Язык сохранён.
          </p>
        ) : null}
      </div>
    </div>
  );
}
