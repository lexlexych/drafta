"use client";

/**
 * Фильтр по категориям в шапке списка диалогов: мультивыбор поверх
 * query-параметра `category` (список id через запятую).
 *
 * Пустой выбор — «все категории», включая диалоги, которым категорию ещё не
 * присвоили; любой явный выбор фильтрует строго.
 */

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import type { CategoryBadgeView } from "@/lib/mock";

import { MultiSelect } from "./multi-select";
import { QUERY_KEYS, parseIdList, serializeIdList } from "./navigation";
import styles from "./panes.module.css";

export function CategoryFilter({
  categories,
}: {
  categories: readonly CategoryBadgeView[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const selected = parseIdList(searchParams.get(QUERY_KEYS.category));

  function onChange(next: string[]) {
    const params = new URLSearchParams(searchParams);
    const value = serializeIdList(next);

    if (value) {
      params.set(QUERY_KEYS.category, value);
    } else {
      params.delete(QUERY_KEYS.category);
    }

    // Открытый диалог может не пройти новый фильтр — закрываем правую панель,
    // чтобы список и деталь не расходились.
    params.delete(QUERY_KEYS.conversation);

    const query = params.toString();

    router.push(query ? `${pathname}?${query}` : pathname);
  }

  if (categories.length === 0) {
    return null;
  }

  return (
    <div className={styles.categoryFilter}>
      <MultiSelect
        label="Фильтр по категориям"
        placeholder="Все категории"
        allLabel="Все категории"
        emptyLabel="Все категории"
        options={categories.map((category) => ({
          value: category.id,
          label: category.name,
        }))}
        selected={selected}
        onChange={onChange}
      />
    </div>
  );
}
