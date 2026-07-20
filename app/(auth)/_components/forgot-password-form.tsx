"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";

import {
  createAuthCallbackUrl,
  passwordRecoveryCallbackPath,
} from "@/lib/auth/callback-paths";
import { createBrowserSupabaseClient } from "@/lib/db/browser";

import styles from "../auth.module.css";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    setIsSubmitting(true);

    const supabase = createBrowserSupabaseClient();
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(
      email.trim().toLowerCase(),
      {
        redirectTo: createAuthCallbackUrl(
          window.location.origin,
          passwordRecoveryCallbackPath,
        ),
      },
    );

    setIsSubmitting(false);

    if (resetError) {
      setError(resetError.message);
      return;
    }

    setSuccess("Если адрес зарегистрирован, письмо для сброса уже отправлено.");
  }

  return (
    <>
      <h1 className={styles.heading}>Сброс пароля</h1>
      <p className={styles.description}>
        Укажите email — Supabase отправит ссылку для установки нового пароля.
      </p>

      <form className={styles.form} onSubmit={handleSubmit}>
        <label className={styles.field}>
          Email
          <input
            autoComplete="email"
            className={styles.input}
            name="email"
            onChange={(event) => setEmail(event.target.value)}
            required
            type="email"
            value={email}
          />
        </label>

        {error ? (
          <p aria-live="polite" className={`${styles.message} ${styles.error}`}>
            {error}
          </p>
        ) : null}
        {success ? (
          <p aria-live="polite" className={`${styles.message} ${styles.success}`}>
            {success}
          </p>
        ) : null}

        <button className={styles.button} disabled={isSubmitting} type="submit">
          {isSubmitting ? "Подождите…" : "Отправить ссылку"}
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
