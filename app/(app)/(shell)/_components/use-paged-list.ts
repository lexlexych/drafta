"use client";

/**
 * Списки экранов: страница с сервера + дозагрузка следующих при скролле и
 * перезагрузка первой страницы при смене фильтра.
 *
 * Отбор делает серверное действие, а не клиент: список может быть сколь угодно
 * длинным, и фильтровать надо в запросе, а не по уже загруженной странице.
 * Значение фильтра при этом не уходит в адрес — иначе «Назад» возвращал бы к
 * предыдущему фильтру вместо предыдущего экрана.
 *
 * Пока фильтр пуст, компонент показывает ровно то, что отрендерил сервер: при
 * `revalidatePath` (realtime-обновления, отметка «прочитано») список обновится
 * сам. Как только фильтр выбран или подгружена вторая страница, источником
 * становится состояние — до следующего сброса фильтра в пустой.
 *
 * Фильтр живёт здесь же: перезагрузка идёт из обработчика его смены, а не из
 * эффекта по изменившемуся состоянию — эффект тут был бы каскадным рендером
 * ради того, что уже известно в момент клика.
 */

import { useCallback, useState } from "react";

import { useActivityTransition } from "./activity";
import { useSentinelObserver } from "./use-sentinel-observer";

export type PageResult<T> =
  | { ok: true; items: T[]; total: number; hasMore: boolean }
  | { ok: false; error: string };

type LoadedPages<T> = {
  items: T[];
  total: number;
  hasMore: boolean;
};

export function usePagedList<T, F>({
  serverItems,
  serverTotal,
  serverHasMore,
  initialFilter,
  isDefaultFilter,
  loadPage,
  activityLabel,
}: {
  serverItems: T[];
  serverTotal: number;
  serverHasMore: boolean;
  /** Фильтр, под которым сервер отрендерил первую страницу. */
  initialFilter: F;
  /** Фильтр пуст — серверная страница уже подходит, запрос не нужен. */
  isDefaultFilter: (filter: F) => boolean;
  loadPage: (filter: F, offset: number) => Promise<PageResult<T>>;
  activityLabel: string;
}) {
  const [filter, setFilterState] = useState<F>(initialFilter);
  const [loaded, setLoaded] = useState<LoadedPages<T> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useActivityTransition(activityLabel);

  const items = loaded?.items ?? serverItems;
  const total = loaded?.total ?? serverTotal;
  const hasMore = loaded?.hasMore ?? serverHasMore;

  function setFilter(next: F) {
    setFilterState(next);
    setError(null);

    if (isDefaultFilter(next)) {
      // Серверная страница уже отрендерена под пустым фильтром — берём её.
      setLoaded(null);
      return;
    }

    startTransition(async () => {
      const page = await loadPage(next, 0);

      if (!page.ok) {
        setError(page.error);
        return;
      }

      setLoaded({
        items: page.items,
        total: page.total,
        hasMore: page.hasMore,
      });
    });
  }

  const loadMore = useCallback(() => {
    startTransition(async () => {
      const page = await loadPage(filter, items.length);

      if (!page.ok) {
        setError(page.error);
        return;
      }

      setLoaded({
        items: [...items, ...page.items],
        total: page.total,
        hasMore: page.hasMore,
      });
    });
  }, [filter, items, loadPage, startTransition]);

  // Маячок стоит в конце списка: подгрузка идёт вниз, к более старым записям.
  const { rootRef: listRef, sentinelRef } = useSentinelObserver({
    enabled: hasMore && !isPending && error === null,
    onReached: loadMore,
  });

  return {
    filter,
    setFilter,
    items,
    total,
    hasMore,
    isPending,
    error,
    listRef,
    sentinelRef,
  };
}
