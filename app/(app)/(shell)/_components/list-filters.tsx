"use client";

/**
 * Шапка-фильтр списков: мультивыбор каналов и (для «Сообщений») категорий.
 *
 * Оба фильтра — клиентское состояние владельца списка, а не query-параметры:
 * иначе каждое переключение фильтра добавляло бы запись в историю и «Назад»
 * возвращал бы к прошлому фильтру вместо предыдущего экрана.
 *
 * Пустой выбор означает «все», поэтому кнопки «Снять все» здесь нет —
 * достаточно снять галочки.
 */

import type { CategoryBadgeView, ChannelFilterView } from "@/lib/mock";
import { countWithNoun } from "@/lib/mock/plural";

import { MultiSelect } from "./multi-select";
import styles from "./panes.module.css";

/**
 * Подпись выбора в подзаголовке списка: пусто — `emptyLabel`, одно значение —
 * его название, несколько — «3 канала».
 */
export function scopeLabel(
  selected: readonly string[],
  options: readonly { id: string; name: string }[],
  emptyLabel: string,
  forms: [string, string, string],
): string {
  if (selected.length === 0) {
    return emptyLabel;
  }

  if (selected.length === 1) {
    return (
      options.find((option) => option.id === selected[0])?.name ??
      countWithNoun(1, forms)
    );
  }

  return countWithNoun(selected.length, forms);
}

export function ListFilters({
  channels,
  selectedChannelIds,
  onChannelsChange,
  categories,
  selectedCategoryIds,
  onCategoriesChange,
}: {
  channels: readonly ChannelFilterView[];
  selectedChannelIds: readonly string[];
  onChannelsChange: (next: string[]) => void;
  /** Не передан — колонки категорий нет (Комментарии, Контакты). */
  categories?: readonly CategoryBadgeView[];
  selectedCategoryIds?: readonly string[];
  onCategoriesChange?: (next: string[]) => void;
}) {
  const hasCategories = Boolean(categories && categories.length > 0);

  if (channels.length === 0 && !hasCategories) {
    return null;
  }

  return (
    <div className={styles.filters}>
      {channels.length > 0 ? (
        <div className={styles.filterField}>
          <MultiSelect
            label="Фильтр по каналам"
            placeholder="Все каналы"
            allLabel="Все каналы"
            emptyLabel="Все каналы"
            countLabel="Каналы"
            showClearAll={false}
            options={channels.map((channel) => ({
              value: channel.id,
              label: channel.name,
              hint: channel.count > 0 ? String(channel.count) : undefined,
            }))}
            selected={selectedChannelIds}
            onChange={onChannelsChange}
          />
        </div>
      ) : null}

      {categories && hasCategories && onCategoriesChange ? (
        <div className={styles.filterField}>
          <MultiSelect
            label="Фильтр по категориям"
            placeholder="Все категории"
            allLabel="Все категории"
            emptyLabel="Все категории"
            countLabel="Категории"
            showClearAll={false}
            options={categories.map((category) => ({
              value: category.id,
              label: category.name,
            }))}
            selected={selectedCategoryIds ?? []}
            onChange={onCategoriesChange}
          />
        </div>
      ) : null}
    </div>
  );
}
