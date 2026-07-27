"use client";

/**
 * Глобальный индикатор «идёт действие»: маленькая плашка со спиннером в углу
 * экрана.
 *
 * Зачем: серверные действия и переходы отвечают не мгновенно, и без отклика
 * непонятно, нажалась ли кнопка вообще. Плашка не блокирует экран и ничего не
 * перекрывает — современный неблокирующий паттерн вместо модального оверлея.
 *
 * Устройство: счётчик активных операций в модуле (не React-контекст — чтобы
 * сообщать о начале операции можно было из любого места, включая колбэки вне
 * дерева), компоненты подписываются через `useSyncExternalStore`.
 *
 * Как пользоваться:
 * - `useActivityTransition()` вместо `useTransition()` — переход сам себя
 *   отмечает, пока он pending;
 * - `<LinkActivity />` внутри `<Link>` — переход по ссылке отмечается, пока
 *   Next догружает целевой сегмент;
 * - `useActivityFlag(isPending, "…")` — для своего состояния загрузки.
 */

import { useLinkStatus } from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
  type TransitionStartFunction,
} from "react";

import styles from "./activity.module.css";

const DEFAULT_LABEL = "Загружаем…";

/** Плашка появляется не сразу: быстрые действия не должны ею мигать. */
const SHOW_DELAY_MS = 250;
/** А появившись — держится минимум столько, иначе мигает уже сама. */
const MIN_VISIBLE_MS = 500;

type ActivitySnapshot = {
  active: boolean;
  label: string;
};

const IDLE: ActivitySnapshot = { active: false, label: DEFAULT_LABEL };

const running = new Map<number, string>();
const listeners = new Set<() => void>();
let nextId = 1;
let snapshot: ActivitySnapshot = IDLE;

function publish() {
  const labels = [...running.values()];

  snapshot =
    labels.length === 0
      ? IDLE
      : { active: true, label: labels[labels.length - 1] ?? DEFAULT_LABEL };

  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

/**
 * Отмечает начало операции; возвращает функцию завершения. Вызов завершения
 * повторно безопасен — счётчик не уйдёт в минус.
 */
export function startActivity(label: string = DEFAULT_LABEL): () => void {
  const id = nextId;
  nextId += 1;
  running.set(id, label);
  publish();

  return () => {
    if (running.delete(id)) {
      publish();
    }
  };
}

function useActivitySnapshot(): ActivitySnapshot {
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => IDLE,
  );
}

/** Пока `active` истинно — операция считается идущей. */
export function useActivityFlag(active: boolean, label?: string): void {
  useEffect(() => {
    if (!active) {
      return;
    }

    return startActivity(label);
  }, [active, label]);
}

/**
 * `useTransition`, который сам сообщает индикатору, что идёт работа. Возвращает
 * ту же пару, что и оригинал, — на месте вызова ничего больше менять не нужно.
 */
export function useActivityTransition(
  label?: string,
): [boolean, TransitionStartFunction] {
  const [isPending, startTransition] = useTransition();

  useActivityFlag(isPending, label);

  return [isPending, startTransition];
}

/**
 * Ставится внутрь `<Link>`: `useLinkStatus` работает только у потомка ссылки и
 * отдаёт `pending`, пока Next догружает целевой сегмент.
 */
export function LinkActivity({ label }: { label?: string }) {
  const { pending } = useLinkStatus();

  useActivityFlag(pending, label);

  return null;
}

/** Сама плашка. Монтируется один раз — в оболочке защищённой зоны. */
export function ActivityIndicator() {
  const { active, label } = useActivitySnapshot();
  const [isVisible, setIsVisible] = useState(false);
  const shownAtRef = useRef(0);
  // Подпись фиксируем на время показа: если операции сменяются, текст не
  // должен дёргаться на последних миллисекундах.
  const [shownLabel, setShownLabel] = useState(DEFAULT_LABEL);

  const show = useCallback((next: string) => {
    shownAtRef.current = Date.now();
    setShownLabel(next);
    setIsVisible(true);
  }, []);

  useEffect(() => {
    if (active) {
      if (isVisible) {
        return;
      }

      const timer = setTimeout(() => show(label), SHOW_DELAY_MS);

      return () => clearTimeout(timer);
    }

    if (!isVisible) {
      return;
    }

    const elapsed = Date.now() - shownAtRef.current;
    const timer = setTimeout(
      () => setIsVisible(false),
      Math.max(0, MIN_VISIBLE_MS - elapsed),
    );

    return () => clearTimeout(timer);
  }, [active, isVisible, label, show]);

  return (
    <div
      aria-live="polite"
      className={styles.indicator}
      data-visible={isVisible}
      role="status"
    >
      {isVisible ? (
        <>
          <Spinner />
          <span className={styles.label}>{shownLabel}</span>
        </>
      ) : null}
    </div>
  );
}

function Spinner() {
  return (
    <svg
      aria-hidden="true"
      className={styles.spinner}
      focusable="false"
      height="16"
      viewBox="0 0 24 24"
      width="16"
    >
      <circle
        className={styles.spinnerTrack}
        cx="12"
        cy="12"
        fill="none"
        r="9"
        strokeWidth="3"
      />
      <circle
        className={styles.spinnerArc}
        cx="12"
        cy="12"
        fill="none"
        r="9"
        strokeDasharray="18 40"
        strokeLinecap="round"
        strokeWidth="3"
      />
    </svg>
  );
}
