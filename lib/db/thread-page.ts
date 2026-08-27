import "server-only";

/**
 * Постраничная загрузка треда — переписки и ветки комментариев под публикацией.
 *
 * Тред грузится не целиком, а окном: последние `THREAD_PAGE_SIZE` записей, а
 * скролл вверх подтягивает предыдущие. Курсор, а не `offset`, как у списков
 * (`lib/db/inbox.ts`'s `getConversationListView`): пока оператор листает вверх,
 * снизу может приехать новое сообщение, и offset-окно съехало бы на запись.
 *
 * Ключ курсора — `(created_at, id)`: у `created_at` нет уникальности, а два
 * сообщения одной секунды должны иметь детерминированный порядок. Тот же
 * тай-брейк уже стоит в `lib/inngest/functions/draft-pipeline.ts`.
 */

/** Граница страницы: записи строго старше этой. */
export type ThreadCursor = {
  createdAt: string;
  id: string;
};

/** Размер страницы треда: первая порция и каждая подгрузка вверх. */
export const THREAD_PAGE_SIZE = 20;

/**
 * Курсор приходит с клиента через серверное действие, а значения уходят прямо в
 * текст фильтра PostgREST — поэтому форма проверяется, а не подразумевается.
 * Кавычка или запятая в значении иначе дописала бы к запросу своё выражение.
 *
 * Отметка времени не пересобирается через `Date`: в Postgres у неё микросекунды,
 * а JS округлил бы их до миллисекунд — и записи между округлённой и настоящей
 * границей потерялись бы.
 */
const TIMESTAMP_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?([+-]\d{2}:?\d{2}|Z)?$/;
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * Фильтр «строго старше курсора» для PostgREST.
 *
 * `.or(...)` соединяется с остальными `.eq(...)` запроса по AND, поэтому тенант
 * и родительская запись остаются на месте. Значения в кавычках: в ISO-8601 есть
 * `:` и `+`, которые PostgREST иначе разберёт как часть выражения.
 */
export function olderThan<Q extends { or(filter: string): Q }>(
  query: Q,
  cursor: ThreadCursor | null,
): Q {
  if (!cursor) {
    return query;
  }

  if (!TIMESTAMP_RE.test(cursor.createdAt) || !UUID_RE.test(cursor.id)) {
    throw new Error("Malformed thread cursor.");
  }

  return query.or(
    `created_at.lt."${cursor.createdAt}",and(created_at.eq."${cursor.createdAt}",id.lt."${cursor.id}")`,
  );
}

/**
 * Разбирает выборку страницы: запрашивается `limit + 1` записей по убыванию,
 * лишняя говорит «выше есть ещё» без второго запроса с `count`. Наружу страница
 * отдаётся в хронологии, как её рисует тред.
 */
export function toThreadPage<T>(
  rows: T[],
  limit: number,
): { rows: T[]; hasMoreBefore: boolean } {
  const hasMoreBefore = rows.length > limit;
  const page = hasMoreBefore ? rows.slice(0, limit) : rows;

  return { rows: [...page].reverse(), hasMoreBefore };
}
