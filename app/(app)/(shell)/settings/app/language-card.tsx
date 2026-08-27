"use client";

/**
 * Язык приложения на весь workspace (`workspaces.settings.lang`). Сохраняется
 * сразу по выбору — отдельной кнопки «Сохранить» у одного поля не нужно.
 * Интерфейс пока не переводится: это только сохранённое предпочтение.
 */

import { useState } from "react";

import {
  WORKSPACE_LANGUAGES,
  type WorkspaceLanguage,
} from "@/lib/i18n/languages";

import uiStyles from "../../_components/ui.module.css";
import { useActivityTransition } from "../../_components/activity";
import styles from "../settings.module.css";
import { saveWorkspaceLanguageAction } from "./actions";

export function LanguageCard({
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
