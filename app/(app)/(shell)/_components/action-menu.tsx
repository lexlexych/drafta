"use client";

/**
 * Кнопка «⋯» и контекстное меню действий над объектом (слайд, черновик).
 *
 * Своя реализация — в проекте нет Radix/shadcn; outside-click и Escape устроены
 * так же, как в `template-picker.tsx`. Стрелки ↑/↓ переводят фокус по пунктам.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";

import { MoreIcon } from "./icons";
import styles from "./action-menu.module.css";

export type ActionMenuItem = {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
};

export function ActionMenu({
  label,
  items,
  variant = "plain",
  align = "end",
}: {
  /** Доступное имя кнопки, например «Действия со слайдом 2». */
  label: string;
  items: readonly (ActionMenuItem | false | null | undefined)[];
  /** `overlay` — полупрозрачная кнопка поверх картинки. */
  variant?: "plain" | "overlay";
  align?: "start" | "end";
}) {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const visible = items.filter(Boolean) as ActionMenuItem[];

  useEffect(() => {
    if (!isOpen) return;
    menuRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen]);

  function moveFocus(offset: number) {
    const buttons = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
    if (!buttons.length) return;
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    buttons[(index + offset + buttons.length) % buttons.length]?.focus();
  }

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        data-variant={variant}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
      >
        <MoreIcon />
      </button>
      {isOpen ? (
        <div
          ref={menuRef}
          className={styles.menu}
          data-align={align}
          role="menu"
          aria-label={label}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") { event.preventDefault(); moveFocus(1); }
            if (event.key === "ArrowUp") { event.preventDefault(); moveFocus(-1); }
          }}
        >
          {visible.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className={styles.item}
              data-danger={item.danger || undefined}
              disabled={item.disabled}
              onClick={() => {
                setIsOpen(false);
                item.onSelect();
              }}
            >
              {item.icon ? <span className={styles.icon}>{item.icon}</span> : null}
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
