"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

import { defaultAuthenticatedPath } from "@/lib/auth/redirects";
import { createBrowserSupabaseClient } from "@/lib/db/browser";

import styles from "../../app.module.css";

export function WorkspaceForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const workspaceName = name.trim();

    if (!workspaceName) {
      setError("Введите название рабочего пространства.");
      return;
    }

    setIsSubmitting(true);

    const supabase = createBrowserSupabaseClient();
    const { data, error: rpcError } = await supabase.rpc("create_workspace", {
      name: workspaceName,
    });

    if (rpcError || !data) {
      setIsSubmitting(false);
      setError("Не удалось создать рабочее пространство. Попробуйте ещё раз.");
      return;
    }

    router.replace(defaultAuthenticatedPath);
    router.refresh();
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <label className={styles.field}>
        Название рабочего пространства
        <input
          autoComplete="organization"
          className={styles.input}
          name="workspaceName"
          onChange={(event) => setName(event.target.value)}
          required
          type="text"
          value={name}
        />
      </label>

      {error ? (
        <p aria-live="polite" className={styles.message}>
          {error}
        </p>
      ) : null}

      <button className={styles.button} disabled={isSubmitting} type="submit">
        {isSubmitting ? "Создаём…" : "Создать рабочее пространство"}
      </button>
    </form>
  );
}
