"use client";

/** Редактор заметок контакта. Заметки попадают в промпт черновика (этап 7). */

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import uiStyles from "../_components/ui.module.css";
import cardStyles from "./contacts.module.css";
import { updateContactNotesAction } from "./actions";

export function ContactNotes({
  contactId,
  notes,
}: {
  contactId: string;
  notes: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState(notes);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const isDirty = value.trim() !== notes.trim();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    startTransition(async () => {
      const result = await updateContactNotesAction({ contactId, notes: value });

      if (!result.ok) {
        setError(result.error);
        return;
      }

      router.refresh();
    });
  }

  return (
    <form className={cardStyles.notesForm} onSubmit={handleSubmit}>
      <textarea
        className={cardStyles.notesInput}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        rows={4}
        placeholder="Заметки о контакте — попадают в промпт черновика."
        disabled={isPending}
      />
      {error ? (
        <p className={cardStyles.notesError} role="alert">
          {error}
        </p>
      ) : null}
      <div className={cardStyles.notesActions}>
        <button
          type="submit"
          className={`${uiStyles.button} ${uiStyles.buttonSmall} ${uiStyles.buttonPrimary}`}
          disabled={isPending || !isDirty}
        >
          {isPending ? "Сохранение…" : "Сохранить заметку"}
        </button>
      </div>
    </form>
  );
}
