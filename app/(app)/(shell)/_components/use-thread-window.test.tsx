// @vitest-environment jsdom

/**
 * Окно треда: последняя страница приходит с сервера пропсами, предыдущие —
 * серверным действием, когда маячок над первой записью попадает в поле зрения.
 *
 * Отдельная забота этого хука по сравнению с `usePagedList` — ужиться с
 * `router.refresh()` от Realtime: серверная страница приезжает заново на каждое
 * входящее, и подгруженная сверху история не должна от этого исчезать.
 */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installIntersectionObserver } from "@/tests/support/intersection-observer";

import {
  useThreadWindow,
  type OlderPageResult,
  type ThreadWindowCursor,
} from "./use-thread-window";

type Item = { id: string; createdAt: string };

const loadOlder = vi.fn<(before: ThreadWindowCursor) => Promise<OlderPageResult<Item>>>();

function item(id: string, minute: number): Item {
  return {
    id,
    createdAt: `2026-08-27T10:${String(minute).padStart(2, "0")}:00+00:00`,
  };
}

function Harness({
  items,
  hasMoreBefore,
  resetKey = "cnv_1",
}: {
  items: Item[];
  hasMoreBefore: boolean;
  resetKey?: string;
}) {
  const { items: visible, hasMore, error, containerRef, sentinelRef } =
    useThreadWindow<Item>({
      serverItems: items,
      serverHasMoreBefore: hasMoreBefore,
      resetKey,
      loadOlder,
      activityLabel: "Загружаем…",
    });

  return (
    <div ref={containerRef}>
      <div aria-hidden="true" ref={sentinelRef} />
      {error ? <p>{error}</p> : null}
      <p data-testid="items">{visible.map((entry) => entry.id).join(",")}</p>
      <p data-testid="has-more">{String(hasMore)}</p>
    </div>
  );
}

function ids() {
  return screen.getByTestId("items").textContent;
}

beforeEach(() => {
  loadOlder.mockReset();
  installIntersectionObserver();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("useThreadWindow", () => {
  it("shows the server page and asks for nothing while it is the whole thread", async () => {
    render(<Harness items={[item("m4", 4), item("m5", 5)]} hasMoreBefore={false} />);

    expect(ids()).toBe("m4,m5");
    expect(screen.getByTestId("has-more").textContent).toBe("false");
    expect(loadOlder).not.toHaveBeenCalled();
  });

  it("prepends the previous page when the sentinel above the thread shows up", async () => {
    loadOlder.mockResolvedValue({
      ok: true,
      items: [item("m2", 2), item("m3", 3)],
      hasMore: false,
    });

    render(<Harness items={[item("m4", 4), item("m5", 5)]} hasMoreBefore />);

    await waitFor(() => expect(ids()).toBe("m2,m3,m4,m5"));
    // Курсор — самая старая из уже загруженных записей.
    expect(loadOlder).toHaveBeenCalledWith({
      createdAt: "2026-08-27T10:04:00+00:00",
      id: "m4",
    });
    await waitFor(() =>
      expect(screen.getByTestId("has-more").textContent).toBe("false"),
    );
  });

  it("keeps the loaded history when realtime re-renders the server page", async () => {
    loadOlder.mockResolvedValue({
      ok: true,
      items: [item("m2", 2), item("m3", 3)],
      hasMore: false,
    });

    const { rerender } = render(
      <Harness items={[item("m4", 4), item("m5", 5)]} hasMoreBefore />,
    );

    await waitFor(() => expect(ids()).toBe("m2,m3,m4,m5"));

    // Пришло входящее: сервер перерисовал последнюю страницу, окно уехало на
    // запись вперёд — подгруженное сверху остаётся на месте.
    rerender(
      <Harness items={[item("m5", 5), item("m6", 6)]} hasMoreBefore={false} />,
    );

    // Подгрузка сверху шла через `startTransition`, и к моменту перерисовки
    // переход мог ещё не осесть. Ждём итог, а не мгновенный снимок: промежуточные
    // состояния с этой строкой не совпадают, так что ожидание ничего не прячет.
    await waitFor(() => expect(ids()).toBe("m2,m3,m4,m5,m6"));
  });

  it("starts over when the server page no longer overlaps what we hold", async () => {
    loadOlder.mockResolvedValue({
      ok: true,
      items: [item("m2", 2)],
      hasMore: false,
    });

    const { rerender } = render(<Harness items={[item("m3", 3)]} hasMoreBefore />);

    await waitFor(() => expect(ids()).toBe("m2,m3"));

    // Вкладка простояла, пока пришло больше страницы: между окнами дыра, и
    // склеивать их нельзя.
    rerender(<Harness items={[item("m40", 40), item("m41", 41)]} hasMoreBefore />);

    expect(ids()).toBe("m40,m41");
    expect(screen.getByTestId("has-more").textContent).toBe("true");
  });

  it("starts over on another thread", async () => {
    loadOlder.mockResolvedValue({
      ok: true,
      items: [item("m2", 2)],
      hasMore: false,
    });

    const { rerender } = render(<Harness items={[item("m3", 3)]} hasMoreBefore />);

    await waitFor(() => expect(ids()).toBe("m2,m3"));

    // Оператор открыл другой диалог — накопленное окно к нему отношения не
    // имеет, даже если записи там старее.
    rerender(
      <Harness items={[item("c9", 9)]} hasMoreBefore={false} resetKey="cnv_2" />,
    );

    expect(ids()).toBe("c9");
    expect(screen.getByTestId("has-more").textContent).toBe("false");
  });

  it("reports a failed page and stops asking", async () => {
    loadOlder.mockResolvedValue({ ok: false, error: "Не удалось загрузить сообщения." });

    render(<Harness items={[item("m4", 4)]} hasMoreBefore />);

    await waitFor(() =>
      expect(screen.getByText("Не удалось загрузить сообщения.")).toBeDefined(),
    );
    expect(ids()).toBe("m4");
  });
});
