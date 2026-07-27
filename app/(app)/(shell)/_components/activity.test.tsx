// @vitest-environment jsdom

/**
 * Плашка «идёт действие»: появляется с задержкой (быстрые операции не должны
 * ею мигать), держится минимум полсекунды и уходит, когда операций не осталось.
 */

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ActivityIndicator, startActivity } from "./activity";

vi.mock("next/link", () => ({
  default: () => null,
  useLinkStatus: () => ({ pending: false }),
}));

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("ActivityIndicator", () => {
  it("stays hidden for operations that finish quickly", () => {
    render(<ActivityIndicator />);

    const stop = startActivity("Сохраняем…");

    act(() => {
      vi.advanceTimersByTime(100);
    });
    stop();
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(screen.queryByText("Сохраняем…")).toBeNull();
    expect(
      screen.getByRole("status").getAttribute("data-visible"),
    ).toBe("false");
  });

  it("shows the label of a long operation and hides it afterwards", () => {
    render(<ActivityIndicator />);

    let stop: () => void = () => {};

    act(() => {
      stop = startActivity("Загружаем диалоги…");
    });

    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(screen.getByText("Загружаем диалоги…")).toBeDefined();
    expect(screen.getByRole("status").getAttribute("data-visible")).toBe("true");

    act(() => {
      stop();
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(screen.queryByText("Загружаем диалоги…")).toBeNull();
  });
});
