"use client";

import { type FormEvent, useState } from "react";

import styles from "../../app.module.css";
import { createWorkspaceAction } from "../actions";

export function WorkspaceForm() {
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

    const result = await createWorkspaceAction({
      name: workspaceName,
    });

    setIsSubmitting(false);
    setError(result.error);
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
