"use client";

/**
 * Мультиселект-дропдаун: кнопка-триггер + панель с чекбоксами.
 *
 * Пишем свой, а не берём готовый: в проекте нет ни shadcn/ui, ни Radix, ни
 * Tailwind — только CSS-модули и нативные контролы, а нативный `<select
 * multiple>` не даёт ни «выбрать все», ни пометок у опций. Используется в двух
 * местах: выбор файлов базы знаний в категории и фильтр по категориям в списке
 * диалогов.
 */

import { useEffect, useId, useRef, useState } from "react";

import styles from "./multi-select.module.css";
import uiStyles from "./ui.module.css";

export type MultiSelectOption = {
  value: string;
  label: string;
  /** Мелкая пометка справа от названия — например «выключен в базе знаний». */
  hint?: string;
};

export function MultiSelect({
  options,
  selected,
  onChange,
  label,
  placeholder,
  emptyLabel = "Ничего не выбрано",
  allLabel,
  countLabel = "Выбрано",
  showClearAll = true,
  disabled = false,
}: {
  options: readonly MultiSelectOption[];
  selected: readonly string[];
  onChange: (next: string[]) => void;
  /** Доступное имя контрола — на кнопке визуального лейбла нет. */
  label: string;
  /** Текст кнопки, когда выбрано всё или выбор пуст и это нормально. */
  placeholder?: string;
  emptyLabel?: string;
  /** Текст кнопки, когда выбраны все опции. */
  allLabel?: string;
  /** Слово перед числом выбранного: «Каналы: 2», «Категории: 2». */
  countLabel?: string;
  /** «Снять все» не нужен там, где пустой выбор и так означает «все». */
  showClearAll?: boolean;
  disabled?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const listId = useId();

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen]);

  const selectedSet = new Set(selected);
  const allSelected =
    options.length > 0 && options.every((option) => selectedSet.has(option.value));

  const toggle = (value: string) => {
    onChange(
      selectedSet.has(value)
        ? selected.filter((item) => item !== value)
        : [...selected, value],
    );
  };

  const triggerLabel = () => {
    if (selected.length === 0) {
      return placeholder ?? emptyLabel;
    }
    if (allSelected) {
      return allLabel ?? placeholder ?? `Все (${options.length})`;
    }
    if (selected.length === 1) {
      return (
        options.find((option) => option.value === selected[0])?.label ??
        emptyLabel
      );
    }

    return `${countLabel}: ${selected.length}`;
  };

  return (
    <div className={styles.root} ref={containerRef}>
      <button
        type="button"
        className={styles.trigger}
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={isOpen ? listId : undefined}
        disabled={disabled || options.length === 0}
        onClick={() => setIsOpen((open) => !open)}
      >
        <span className={styles.triggerLabel}>{triggerLabel()}</span>
        <span aria-hidden="true" className={styles.caret}>
          ▾
        </span>
      </button>

      {isOpen ? (
        <div className={styles.panel}>
          <div className={styles.panelActions}>
            <button
              type="button"
              className={`${uiStyles.button} ${uiStyles.buttonGhost} ${uiStyles.buttonSmall}`}
              onClick={() => onChange(options.map((option) => option.value))}
            >
              Выбрать все
            </button>
            {showClearAll ? (
              <button
                type="button"
                className={`${uiStyles.button} ${uiStyles.buttonGhost} ${uiStyles.buttonSmall}`}
                onClick={() => onChange([])}
              >
                Снять все
              </button>
            ) : null}
          </div>

          <ul
            className={styles.list}
            id={listId}
            role="listbox"
            aria-multiselectable="true"
            aria-label={label}
          >
            {options.map((option) => {
              const isSelected = selectedSet.has(option.value);

              return (
                <li key={option.value} role="option" aria-selected={isSelected}>
                  <label className={styles.option}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggle(option.value)}
                    />
                    <span className={styles.optionLabel}>{option.label}</span>
                    {option.hint ? (
                      <span className={styles.optionHint}>{option.hint}</span>
                    ) : null}
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
