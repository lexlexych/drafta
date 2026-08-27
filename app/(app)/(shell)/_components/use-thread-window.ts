"use client";

/**
 * Окно треда: последняя страница с сервера плюс подгрузка предыдущих при
 * скролле вверх. Парный к `usePagedList` хук — только тред растёт не вниз, а
 * вверх, и открывается на своём хвосте.
 *
 * Почему состояние — «всё, что видели», а не «серверная страница или наша»:
 * тред живёт под Realtime, и новая запись приезжает не событием в клиент, а
 * `router.refresh()` (см. `lib/realtime/inbox-sync.ts`) — сервер перерисовывает
 * последние N записей. Если бы клиент после первой подгрузки вверх переставал
 * смотреть на серверную страницу, входящие перестали бы появляться; если бы,
 * наоборот, брал только её — подгруженная история исчезала бы при каждом
 * входящем. Поэтому серверная страница вмерживается в накопленное окно: её
 * версия записи побеждает (так доезжает смена статуса доставки), а всё, что
 * выше, остаётся на месте.
 *
 * Единственный разрыв, который так не закрыть: вкладка простояла, пока пришло
 * больше страницы новых записей, — новое окно не пересекается со старым, и
 * между ними дыра. Тогда накопленное отбрасывается, и тред начинается заново с
 * серверной страницы.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { useActivityTransition } from "./activity";
import { useSentinelObserver } from "./use-sentinel-observer";

/** Минимум, который должен уметь элемент треда: id и момент публикации. */
export type ThreadWindowItem = {
  id: string;
  createdAt: string;
};

/** Граница страницы: записи строго старше этой (`lib/db/thread-page.ts`). */
export type ThreadWindowCursor = {
  createdAt: string;
  id: string;
};

export type OlderPageResult<T> =
  | { ok: true; items: T[]; hasMore: boolean }
  | { ok: false; error: string };

/** Насколько близко к низу оператор должен быть, чтобы тред доскроллился сам. */
const STICK_TO_BOTTOM_PX = 64;

function compareItems(a: ThreadWindowItem, b: ThreadWindowItem): number {
  const at = Date.parse(a.createdAt);
  const bt = Date.parse(b.createdAt);

  if (at !== bt) {
    return at - bt;
  }

  // Тот же тай-брейк, что и в запросе: у `created_at` нет уникальности.
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Новое окно целиком новее накопленного и не пересекается с ним — между ними
 * потерянные записи. Склеивать такие половины нельзя: в треде появилась бы
 * невидимая дыра.
 */
export function hasWindowGap<T extends ThreadWindowItem>(
  previous: readonly T[],
  incoming: readonly T[],
): boolean {
  const newest = previous[previous.length - 1];
  const oldestIncoming = incoming[0];

  if (!newest || !oldestIncoming) {
    return false;
  }

  const ids = new Set(previous.map((item) => item.id));

  if (incoming.some((item) => ids.has(item.id))) {
    return false;
  }

  return compareItems(newest, oldestIncoming) < 0;
}

/**
 * Сводит две части окна в одну хронологию — порядок аргументов на результат не
 * влияет. Записи с одинаковым `id` схлопываются в пользу `incoming`: вызывающий
 * ставит вторым то, что свежее.
 */
export function mergeThreadWindow<T extends ThreadWindowItem>(
  previous: readonly T[],
  incoming: readonly T[],
): T[] {
  if (incoming.length === 0) {
    return [...previous];
  }

  if (previous.length === 0) {
    return [...incoming];
  }

  const byId = new Map(previous.map((item) => [item.id, item]));

  for (const item of incoming) {
    byId.set(item.id, item);
  }

  return [...byId.values()].sort(compareItems);
}

type WindowState<T> = {
  items: T[];
  hasMore: boolean;
  /** Хоть одна страница вверх подгружена — серверный флаг больше не про нас. */
  olderLoaded: boolean;
};

export function useThreadWindow<T extends ThreadWindowItem>({
  serverItems,
  serverHasMoreBefore,
  resetKey,
  loadOlder,
  activityLabel,
}: {
  /** Последняя страница треда, отрисованная сервером. */
  serverItems: T[];
  serverHasMoreBefore: boolean;
  /** Открытая переписка или публикация: смена — новый тред, окно с нуля. */
  resetKey: string;
  loadOlder: (before: ThreadWindowCursor) => Promise<OlderPageResult<T>>;
  activityLabel: string;
}) {
  const [state, setState] = useState<WindowState<T>>(() => ({
    items: [...serverItems],
    hasMore: serverHasMoreBefore,
    olderLoaded: false,
  }));
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useActivityTransition(activityLabel);

  // Что уже учтено: серверная страница приезжает новым объектом на каждый
  // `router.refresh()`, и вмерживать её надо ровно один раз. Правка состояния
  // прямо в рендере, а не эффектом: к моменту разметки окно должно быть уже
  // сведено, иначе тред мигнёт промежуточным кадром (документированный React
  // приём «состояние, зависящее от пропа»).
  const [synced, setSynced] = useState({ resetKey, serverItems });

  if (synced.resetKey !== resetKey) {
    setSynced({ resetKey, serverItems });
    setState({
      items: [...serverItems],
      hasMore: serverHasMoreBefore,
      olderLoaded: false,
    });
    setError(null);
  } else if (synced.serverItems !== serverItems) {
    setSynced({ resetKey, serverItems });
    setState((previous) => {
      // Дыра между окнами — единственный случай, когда накопленное
      // отбрасывается: склеенный тред молча потерял бы записи между ними.
      const gap = hasWindowGap(previous.items, serverItems);
      const olderLoaded = previous.olderLoaded && !gap;

      return {
        items: gap
          ? [...serverItems]
          : mergeThreadWindow(previous.items, serverItems),
        hasMore: olderLoaded ? previous.hasMore : serverHasMoreBefore,
        olderLoaded,
      };
    });
  }

  const { items, hasMore } = state;

  const containerRef = useRef<HTMLDivElement | null>(null);
  /** Оператор у самого низа — значит, новую запись можно показывать сразу. */
  const atBottomRef = useRef(true);
  /** Размеры до вставки страницы сверху: по ним восстанавливается позиция. */
  const anchorRef = useRef<{ height: number; top: number } | null>(null);

  const loadMore = useCallback(() => {
    const oldest = items[0];

    if (!oldest) {
      return;
    }

    const container = containerRef.current;
    anchorRef.current = container
      ? { height: container.scrollHeight, top: container.scrollTop }
      : null;

    startTransition(async () => {
      const page = await loadOlder({
        createdAt: oldest.createdAt,
        id: oldest.id,
      });

      if (!page.ok) {
        anchorRef.current = null;
        setError(page.error);
        return;
      }

      setState((previous) => ({
        items: mergeThreadWindow(page.items, previous.items),
        hasMore: page.hasMore,
        olderLoaded: true,
      }));
    });
  }, [items, loadOlder, startTransition]);

  const { rootRef, sentinelRef } = useSentinelObserver({
    enabled: hasMore && !isPending && error === null && items.length > 0,
    onReached: loadMore,
  });

  const containerCallbackRef = useCallback(
    (node: HTMLDivElement | null) => {
      containerRef.current = node;
      rootRef.current = node;
    },
    [rootRef],
  );

  // Открытый тред начинается с конца: последняя запись важнее первой.
  useLayoutEffect(() => {
    const container = containerRef.current;

    if (!container) {
      return;
    }

    atBottomRef.current = true;
    anchorRef.current = null;
    container.scrollTop = container.scrollHeight;
  }, [resetKey]);

  useEffect(() => {
    const container = containerRef.current;

    if (!container) {
      return;
    }

    const onScroll = () => {
      atBottomRef.current =
        container.scrollHeight - container.scrollTop - container.clientHeight <
        STICK_TO_BOTTOM_PX;
    };

    container.addEventListener("scroll", onScroll, { passive: true });

    return () => container.removeEventListener("scroll", onScroll);
  }, [resetKey]);

  useLayoutEffect(() => {
    const container = containerRef.current;

    if (!container) {
      return;
    }

    const anchor = anchorRef.current;

    if (anchor) {
      // Страница встала сверху — сдвигаем скролл ровно на её высоту, чтобы
      // текст под курсором остался на месте.
      anchorRef.current = null;
      container.scrollTop = container.scrollHeight - anchor.height + anchor.top;
      return;
    }

    if (atBottomRef.current) {
      container.scrollTop = container.scrollHeight;
    }
  }, [items]);

  return {
    items,
    hasMore,
    isPending,
    error,
    /** На скроллящийся контейнер треда. */
    containerRef: containerCallbackRef,
    /** На пустой элемент над первой записью. */
    sentinelRef,
  };
}
