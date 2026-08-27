import { describe, expect, it, vi } from "vitest";

// `thread-page.ts` импортирует `"server-only"`, который вне сборки Next падает.
vi.mock("server-only", () => ({}));

const { olderThan, toThreadPage, THREAD_PAGE_SIZE } = await import("./thread-page");

type Row = { id: string; created_at: string };

function row(id: string, created_at: string): Row {
  return { id, created_at };
}

/** Ловит фильтр, который уходит в PostgREST, — сам запрос тут не нужен. */
function fakeQuery() {
  const filters: string[] = [];
  const query = {
    filters,
    or(filter: string) {
      filters.push(filter);
      return query;
    },
  };

  return query;
}

describe("olderThan", () => {
  it("asks for rows strictly older than the cursor, tie-broken by id", () => {
    const query = olderThan(fakeQuery(), {
      createdAt: "2026-08-27T10:04:00+00:00",
      id: "b1f0c0de-0000-4000-8000-000000000001",
    });

    // Значения в кавычках: в ISO-8601 есть `:` и `+`, которые PostgREST иначе
    // разберёт как часть выражения фильтра.
    expect(query.filters).toEqual([
      'created_at.lt."2026-08-27T10:04:00+00:00",' +
        'and(created_at.eq."2026-08-27T10:04:00+00:00",' +
        'id.lt."b1f0c0de-0000-4000-8000-000000000001")',
    ]);
  });

  it("leaves the first page unfiltered", () => {
    expect(olderThan(fakeQuery(), null).filters).toEqual([]);
  });

  it("refuses a cursor that could append a filter of its own", () => {
    // Курсор приезжает с клиента через серверное действие, а значения уходят
    // прямо в текст фильтра PostgREST.
    expect(() =>
      olderThan(fakeQuery(), {
        createdAt: '2026-08-27T10:04:00+00:00",or(id.gt."0',
        id: "b1f0c0de-0000-4000-8000-000000000001",
      }),
    ).toThrow("Malformed thread cursor.");

    expect(() =>
      olderThan(fakeQuery(), {
        createdAt: "2026-08-27T10:04:00+00:00",
        id: 'x",or(text.neq."',
      }),
    ).toThrow("Malformed thread cursor.");
  });

  it("takes the timestamp formats PostgREST actually returns", () => {
    for (const createdAt of [
      "2026-08-27T10:04:00+00:00",
      "2026-08-27T10:04:00.123456+00:00",
      "2026-08-27T10:04:00.123Z",
      "2026-08-27T10:04:00",
    ]) {
      expect(
        olderThan(fakeQuery(), {
          createdAt,
          id: "b1f0c0de-0000-4000-8000-000000000001",
        }).filters,
      ).toHaveLength(1);
    }
  });
});

describe("toThreadPage", () => {
  it("turns a descending overshoot into a chronological page", () => {
    // Запрашивается limit + 1 записей по убыванию: лишняя говорит «выше есть
    // ещё» без второго запроса с count.
    const page = toThreadPage(
      [
        row("m5", "2026-08-27T10:05:00+00:00"),
        row("m4", "2026-08-27T10:04:00+00:00"),
        row("m3", "2026-08-27T10:03:00+00:00"),
      ],
      2,
    );

    expect(page.rows.map((item) => item.id)).toEqual(["m4", "m5"]);
    expect(page.hasMoreBefore).toBe(true);
  });

  it("reports the top of the thread when nothing overshoots", () => {
    const page = toThreadPage(
      [row("m5", "2026-08-27T10:05:00+00:00"), row("m4", "2026-08-27T10:04:00+00:00")],
      2,
    );

    expect(page.rows.map((item) => item.id)).toEqual(["m4", "m5"]);
    expect(page.hasMoreBefore).toBe(false);
  });

  it("handles an empty thread", () => {
    expect(toThreadPage([], THREAD_PAGE_SIZE)).toEqual({
      rows: [],
      hasMoreBefore: false,
    });
  });
});
