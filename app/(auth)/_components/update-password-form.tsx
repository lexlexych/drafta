"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";

import { createBrowserSupabaseClient } from "@/lib/db/browser";

import styles from "../auth.module.css";

export function UpdatePasswordForm() {
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("Пароль должен содержать не менее 8 символов.");
      return;
    }

    if (password !== passwordConfirmation) {
      setError("Пароли не совпадают.");
      return;
    }

    setIsSubmitting(true);

    const supabase = createBrowserSupabaseClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });

    if (updateError) {
      setIsSubmitting(false);
      setError(updateError.message);
      return;
    }

    const { error: signOutError } = await supabase.auth.signOut();

    if (signOutError) {
      setIsSubmitting(false);
      setError(
        "Пароль обновлён, но текущую сессию не удалось завершить. Выйдите и войдите с новым паролем.",
      );
      return;
    }

    window.location.assign("/login");
  }

  return (
    <>
      <h1 className={styles.heading}>Новый пароль</h1>
      <p className={styles.description}>
        Установите новый пароль, затем войдите с ним заново.
      </p>

      <form className={styles.form} onSubmit={handleSubmit}>
        <label className={styles.field}>
          Новый пароль
          <input
            autoComplete="new-password"
            className={styles.input}
            name="password"
            onChange={(event) => setPassword(event.target.value)}
            required
            type="password"
            value={password}
          />
        </label>

        <label className={styles.field}>
          Повторите пароль
          <input
            autoComplete="new-password"
            className={styles.input}
            name="passwordConfirmation"
            onChange={(event) => setPasswordConfirmation(event.target.value)}
            required
            type="password"
            value={passwordConfirmation}
          />
        </label>

        <p className={styles.hint}>Используйте не менее 8 символов.</p>

        {error ? (
          <p aria-live="polite" className={`${styles.message} ${styles.error}`}>
            {error}
          </p>
        ) : null}

        <button className={styles.button} disabled={isSubmitting} type="submit">
          {isSubmitting ? "Подождите…" : "Сохранить пароль"}
        </button>
      </form>

      <nav aria-label="Действия авторизации" className={styles.links}>
        <p>
          <Link href="/login">Вернуться ко входу</Link>
        </p>
      </nav>
    </>
  );
}
