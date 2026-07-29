// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  KnowledgeBasePanel,
  type KnowledgeFileListItem,
} from "./knowledge-base-panel";

const createKnowledgeFileAction = vi.fn();
const updateKnowledgeFileAction = vi.fn();
const setKnowledgeFileEnabledAction = vi.fn();
const deleteKnowledgeFileAction = vi.fn();

vi.mock("./actions", () => ({
  createKnowledgeFileAction: (...args: unknown[]) =>
    createKnowledgeFileAction(...args),
  updateKnowledgeFileAction: (...args: unknown[]) =>
    updateKnowledgeFileAction(...args),
  setKnowledgeFileEnabledAction: (...args: unknown[]) =>
    setKnowledgeFileEnabledAction(...args),
  deleteKnowledgeFileAction: (...args: unknown[]) =>
    deleteKnowledgeFileAction(...args),
}));

const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

const files: KnowledgeFileListItem[] = [
  {
    id: "kbf_price",
    name: "Прайс",
    content: "# Прайс\n\nЧашка — **24 €**.",
    sort_order: 1,
    is_enabled: true,
    updated_at: "2026-07-21T10:00:00.000Z",
  },
  {
    id: "kbf_hidden",
    name: "Архив",
    content: "Архив",
    sort_order: 2,
    is_enabled: false,
    updated_at: "2026-07-20T10:00:00.000Z",
  },
];

beforeEach(() => {
  createKnowledgeFileAction.mockResolvedValue({ ok: true, data: {} });
  updateKnowledgeFileAction.mockResolvedValue({ ok: true, data: {} });
  setKnowledgeFileEnabledAction.mockResolvedValue({ ok: true, data: {} });
  deleteKnowledgeFileAction.mockResolvedValue({ ok: true, data: null });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("KnowledgeBasePanel", () => {
  it("renders categories, activation switches and the token budget", () => {
    render(<KnowledgeBasePanel files={files} />);

    expect(screen.getByRole("button", { name: "Прайс" })).toBeDefined();
    expect(
      screen
        .getByRole("switch", { name: "Деактивировать категорию Прайс" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    expect(
      screen
        .getByRole("switch", { name: "Активировать категорию Архив" })
        .getAttribute("aria-checked"),
    ).toBe("false");
    expect(screen.getByText(/1 активных категорий/)).toBeDefined();
  });

  it("edits Markdown with a rendered preview", async () => {
    render(<KnowledgeBasePanel files={files} />);

    fireEvent.click(screen.getByRole("button", { name: "Прайс" }));
    expect(screen.getByRole("heading", { name: "Редактирование категории" })).toBeDefined();
    expect(screen.getByRole("heading", { name: "Прайс" })).toBeDefined();

    fireEvent.change(screen.getByLabelText("Описание категории"), {
      target: { value: "# Новый прайс\n\nВаза — 42 €." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));

    await waitFor(() =>
      expect(updateKnowledgeFileAction).toHaveBeenCalledWith({
        id: "kbf_price",
        name: "Прайс",
        content: "# Новый прайс\n\nВаза — 42 €.",
      }),
    );
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("creates a category straight from the editor, with no file upload", async () => {
    render(<KnowledgeBasePanel files={files} />);

    expect(screen.queryByText("Загрузить .md")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "+ Новая категория" }));
    fireEvent.change(screen.getByLabelText("Категория"), {
      target: { value: "Доставка" },
    });
    fireEvent.change(screen.getByLabelText("Описание категории"), {
      target: { value: "# Доставка\n\nПо городу — 350 ₽." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));

    await waitFor(() =>
      expect(createKnowledgeFileAction).toHaveBeenCalledWith({
        name: "Доставка",
        content: "# Доставка\n\nПо городу — 350 ₽.",
      }),
    );
  });

  it("toggles and deletes a category through server actions", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<KnowledgeBasePanel files={files} />);

    fireEvent.click(
      screen.getByRole("switch", { name: "Деактивировать категорию Прайс" }),
    );
    await waitFor(() =>
      expect(setKnowledgeFileEnabledAction).toHaveBeenCalledWith({
        id: "kbf_price",
        isEnabled: false,
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Прайс" }));
    fireEvent.click(screen.getByRole("button", { name: "Удалить" }));
    await waitFor(() =>
      expect(deleteKnowledgeFileAction).toHaveBeenCalledWith({ id: "kbf_price" }),
    );

    confirmSpy.mockRestore();
  });
});
