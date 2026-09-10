"use client";

/**
 * Смена пароля прямо в разделе «Аккаунт» — рядом с выходом, потому что это
 * действия над одной и той же учётной записью. Раскрывается по кнопке, как
 * «Создать workspace» ниже: постоянно висящие три поля для пароля в разделе не
 * нужны.
 *
 * Текущий пароль спрашиваем всегда — иначе открытой сессии хватило бы, чтобы
 * забрать аккаунт. Проверяет его server action (`./actions`), здесь только
 * длина и совпадение с повтором.
 */

import { useId, useState, type FormEvent } from "react";

import { validateNewPassword } from "@/lib/auth/password";

import { LockIcon } from "../../_components/icons";
import uiStyles from "../../_components/ui.module.css";
import { useActivityTransition } from "../../_components/activity";
import styles from "../settings.module.css";
import { changePasswordAction } from "./actions";

export function PasswordCard() {
  const fieldId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useActivityTransition("Меняем пароль…");

  function reset() {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmation("");
  }

  function handleOpen() {
    setIsOpen(true);
    setError(null);
    setSaved(false);
  }

  function handleCancel() {
    setIsOpen(false);
    setError(null);
    reset();
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!currentPassword) {
      setError("Введите текущий пароль.");
      return;
    }

    const validation = validateNewPassword(newPassword, confirmation);

    if (!validation.ok) {
      setError(validation.error);
      return;
    }

    setError(null);

    startTransition(async () => {
      const result = await changePasswordAction({
        currentPassword,
        newPassword,
      });

      if (!result.ok) {
        setError(result.error);
        return;
      }

      // Пароли не оставляем в стейте дольше, чем нужно.
      reset();
      setIsOpen(false);
      setSaved(true);
    });
  }

  if (!isOpen) {
    return (
      <div>
        <button
          className={`${uiStyles.button} ${uiStyles.buttonSecondary}`}
          onClick={handleOpen}
          type="button"
        >
          <LockIcon /> Поменять пароль
        </button>
        <div aria-live="polite">
          {saved ? (
            <p className={styles.formSuccess} role="status">
              Пароль обновлён.
            </p>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <form
      className={`${uiStyles.card} ${uiStyles.cardStack}`}
      onSubmit={handleSubmit}
    >
      <h3>Смена пароля</h3>

      <div className={uiStyles.field}>
        <label htmlFor={`${fieldId}-current`}>Текущий пароль</label>
        <input
          autoComplete="current-password"
          autoFocus
          disabled={isPending}
          id={`${fieldId}-current`}
          onChange={(event) => setCurrentPassword(event.target.value)}
          type="password"
          value={currentPassword}
        />
      </div>

      <div className={uiStyles.field}>
        <label htmlFor={`${fieldId}-new`}>Новый пароль</label>
        <input
          autoComplete="new-password"
          disabled={isPending}
          id={`${fieldId}-new`}
          onChange={(event) => setNewPassword(event.target.value)}
          type="password"
          value={newPassword}
        />
        <span className={styles.fieldHint}>Используйте не менее 8 символов.</span>
      </div>

      <div className={uiStyles.field}>
        <label htmlFor={`${fieldId}-confirmation`}>Повторите новый пароль</label>
        <input
          autoComplete="new-password"
          disabled={isPending}
          id={`${fieldId}-confirmation`}
          onChange={(event) => setConfirmation(event.target.value)}
          type="password"
          value={confirmation}
        />
      </div>

      <div aria-live="polite">
        {error ? (
          <p className={styles.formError} role="alert">
            {error}
          </p>
        ) : null}
      </div>

      <div className={uiStyles.cardRow}>
        <button
          className={`${uiStyles.button} ${uiStyles.buttonPrimary}`}
          disabled={isPending}
          type="submit"
        >
          {isPending ? "Сохраняем…" : "Сохранить"}
        </button>
        <button
          className={`${uiStyles.button} ${uiStyles.buttonGhost}`}
          disabled={isPending}
          onClick={handleCancel}
          type="button"
        >
          Отмена
        </button>
      </div>
    </form>
  );
}
