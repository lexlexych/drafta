"use client";

/**
 * Заглушки интерактива UI-каркаса: кнопка, показывающая тост, и сам тост.
 * Реальные действия (отправка, настройки, склейка контактов) — этапы 1–8.
 */

import { useEffect, useRef, useState, type ButtonHTMLAttributes } from "react";

import shellStyles from "./shell.module.css";

const TOAST_EVENT = "drafta:toast";

export const STUB_TOAST_TEXT = "Это макет — действие показано условно";

export function showToast(text: string) {
  window.dispatchEvent(new CustomEvent(TOAST_EVENT, { detail: text }));
}

type StubButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  toastText?: string;
};

/** Кнопка-заглушка: единственный эффект — тост. */
export function StubButton({
  toastText = STUB_TOAST_TEXT,
  onClick,
  children,
  ...props
}: StubButtonProps) {
  return (
    <button
      type="button"
      {...props}
      onClick={(event) => {
        onClick?.(event);
        showToast(toastText);
      }}
    >
      {children}
    </button>
  );
}

/** Единственный тост приложения; слушает событие `drafta:toast`. */
export function Toast() {
  const [text, setText] = useState("");
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function onToast(event: Event) {
      setText(String((event as CustomEvent).detail ?? ""));
      setVisible(true);

      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }

      timerRef.current = setTimeout(() => setVisible(false), 2200);
    }

    window.addEventListener(TOAST_EVENT, onToast);

    return () => {
      window.removeEventListener(TOAST_EVENT, onToast);

      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  return (
    <div
      className={`${shellStyles.toast} ${visible ? shellStyles.toastVisible : ""}`}
      role="status"
    >
      {text}
    </div>
  );
}
