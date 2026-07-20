"use client";

/** Фильтр по категории в шапке списка: меняет query-параметр `category`. */

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import type { CategoryBadgeView } from "@/lib/mock";

import { QUERY_KEYS } from "./navigation";
import styles from "./panes.module.css";

export function CategoryFilter({
  categories,
}: {
  categories: CategoryBadgeView[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const current = searchParams.get(QUERY_KEYS.category) ?? "";

  function onChange(value: string) {
    const params = new URLSearchParams(searchParams);

    if (value) {
      params.set(QUERY_KEYS.category, value);
    } else {
      params.delete(QUERY_KEYS.category);
    }

    const query = params.toString();

    router.push(query ? `${pathname}?${query}` : pathname);
  }

  return (
    <select
      className={styles.categorySelect}
      aria-label="Фильтр по категории"
      value={current}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">Все категории</option>
      {categories.map((category) => (
        <option key={category.id} value={category.id}>
          {category.name}
        </option>
      ))}
    </select>
  );
}
