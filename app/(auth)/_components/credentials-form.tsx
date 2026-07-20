"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";

import {
  defaultAuthenticatedPath,
  getSafeRedirectPath,
} from "@/lib/auth/redirects";
import {
  createAuthCallbackUrl,
  emailConfirmationCallbackPath,
} from "@/lib/auth/callback-paths";
import { createBrowserSupabaseClient } from "@/lib/db/browser";

import styles from "../auth.module.css";

type CredentialsFormProps = {
  mode: "login" | "sign-up";
};

export function CredentialsForm({ mode }: CredentialsFormProps) {
  const isSignUp = mode === "sign-up";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    if (isSignUp && password.length < 8) {
      setError("Пароль должен содержать не менее 8 символов.");
      return;
    }

    if (isSignUp && password !== passwordConfirmation) {
      setError("Пароли не совпадают.");
      return;
    }

    setIsSubmitting(true);

    const supabase = createBrowserSupabaseClient();
    const normalizedEmail = email.trim().toLowerCase();

    if (isSignUp) {
      const { error: signUpError } = await supabase.auth.signUp({
        email: normalizedEmail,
        password,
        options: {
          emailRedirectTo: createAuthCallbackUrl(
            window.location.origin,
            emailConfirmationCallbackPath,
          ),
        },
      });

      setIsSubmitting(false);

      if (signUpError) {
        setError(signUpError.message);
        return;
      }

      setSuccess("Проверьте почту и подтвердите адрес по ссылке из письма.");
      return;
    }

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: normalizedEmail,
      password,
    });

    setIsSubmitting(false);

    if (signInError) {
      setError(signInError.message);
      return;
    }

    const nextPath = getSafeRedirectPath(
      new URLSearchParams(window.location.search).get("next"),
      defaultAuthenticatedPath,
    );

    window.location.assign(nextPath);
  }

  return (
    <>
      <h1 className={styles.heading}>{isSignUp ? "Регистрация" : "Вход"}</h1>
      <p className={styles.description}>
        {isSignUp
          ? "Создайте пользователя для рабочего пространства."
          : "Войдите в drafta."}
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

        <label className={styles.field}>
          Пароль
          <input
            autoComplete={isSignUp ? "new-password" : "current-password"}
            className={styles.input}
            name="password"
            onChange={(event) => setPassword(event.target.value)}
            required
            type="password"
            value={password}
          />
        </label>

        {isSignUp ? (
          <>
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
          </>
        ) : null}

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
          {isSubmitting
            ? "Подождите…"
            : isSignUp
              ? "Зарегистрироваться"
              : "Войти"}
        </button>
      </form>

      <nav aria-label="Действия авторизации" className={styles.links}>
        {isSignUp ? (
          <p>
            Уже зарегистрированы? <Link href="/login">Войти</Link>
          </p>
        ) : (
          <>
            <p>
              Нет пользователя? <Link href="/sign-up">Зарегистрироваться</Link>
            </p>
            <p>
              <Link href="/forgot-password">Не помню пароль</Link>
            </p>
          </>
        )}
      </nav>
    </>
  );
}
