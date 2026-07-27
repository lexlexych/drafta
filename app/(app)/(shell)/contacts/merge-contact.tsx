"use client";

/**
 * Ручная склейка контактов (этап 7, docs/architecture/06-data-model.md#contact_identities):
 * выбранный контакт вливается в открытый — его identities и переписки
 * переезжают сюда, заметки и теги объединяются, а сам он удаляется.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

import type { MergeCandidate } from "@/lib/db/contacts";

import uiStyles from "../_components/ui.module.css";
import cardStyles from "./contacts.module.css";
import { mergeContactsAction } from "./actions";
import { useActivityTransition } from "../_components/activity";

export function MergeContact({
  contactId,
  candidates,
}: {
  contactId: string;
  candidates: MergeCandidate[];
}) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useActivityTransition("Склеиваем контакты…");

  if (candidates.length === 0) {
    return null;
  }

  function handleMerge() {
    if (!selectedId) {
      setError("Выберите контакт для склейки.");
      return;
    }

    setError(null);
    startTransition(async () => {
      const result = await mergeContactsAction({
        sourceId: selectedId,
        targetId: contactId,
      });

      if (!result.ok) {
        setError(result.error);
        return;
      }

      setIsOpen(false);
      setSelectedId("");
      router.refresh();
    });
  }

  return (
    <div className={cardStyles.merge}>
      <button
        type="button"
        className={`${uiStyles.button} ${uiStyles.buttonSmall} ${uiStyles.buttonSecondary}`}
        aria-expanded={isOpen}
        onClick={() => {
          setError(null);
          setIsOpen((open) => !open);
        }}
      >
        Склеить с другим…
      </button>

      {isOpen ? (
        <div className={cardStyles.mergePanel}>
          <p className={cardStyles.mergeHint}>
            Другой контакт вольётся в текущий: его каналы, переписки и заметки
            переедут сюда.
          </p>
          <select
            className={cardStyles.mergeSelect}
            value={selectedId}
            onChange={(event) => setSelectedId(event.target.value)}
            disabled={isPending}
            aria-label="Контакт для склейки"
          >
            <option value="">— выберите контакт —</option>
            {candidates.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}
              </option>
            ))}
          </select>
          {error ? (
            <p className={cardStyles.notesError} role="alert">
              {error}
            </p>
          ) : null}
          <div className={cardStyles.mergeActions}>
            <button
              type="button"
              className={`${uiStyles.button} ${uiStyles.buttonSmall} ${uiStyles.buttonGhost}`}
              onClick={() => {
                setIsOpen(false);
                setError(null);
              }}
              disabled={isPending}
            >
              Отмена
            </button>
            <button
              type="button"
              className={`${uiStyles.button} ${uiStyles.buttonSmall} ${uiStyles.buttonPrimary}`}
              onClick={handleMerge}
              disabled={isPending || !selectedId}
            >
              {isPending ? "Склейка…" : "Склеить"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
