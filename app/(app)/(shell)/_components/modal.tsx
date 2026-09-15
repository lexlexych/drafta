"use client";

/**
 * Модальное окно поверх страницы: подтверждения и предпросмотр публикации.
 *
 * Не нативный `<dialog>`: jsdom в тестах не поддерживает `showModal`. Фокус
 * переносится внутрь при открытии и возвращается на прежний элемент при
 * закрытии; Escape и клик по подложке закрывают окно.
 */

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { CloseIcon } from "./icons";
import styles from "./modal.module.css";

export function Modal({
  title,
  onClose,
  children,
  footer,
  size = "sm",
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "lg";
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeRef.current();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previous?.focus?.();
    };
  }, []);

  return createPortal(
    <div className={styles.backdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={panelRef} className={styles.panel} data-size={size} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}>
        <header className={styles.head}>
          <h3>{title}</h3>
          <button type="button" className={styles.close} aria-label="Закрыть окно" onClick={onClose}>
            <CloseIcon />
          </button>
        </header>
        <div className={styles.body}>{children}</div>
        {footer ? <footer className={styles.foot}>{footer}</footer> : null}
      </div>
    </div>,
    document.body,
  );
}
