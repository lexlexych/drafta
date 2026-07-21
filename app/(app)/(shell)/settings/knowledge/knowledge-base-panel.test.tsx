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
    name: "02-прайс.md",
    content: "# Прайс\n\nЧашка — **24 €**.",
    sort_order: 1,
    is_enabled: true,
    updated_at: "2026-07-21T10:00:00.000Z",
  },
  {
    id: "kbf_hidden",
    name: "03-архив.md",
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
  it("renders files, activation switches and the token budget", () => {
    render(<KnowledgeBasePanel files={files} />);

    expect(screen.getByRole("button", { name: "02-прайс.md" })).toBeDefined();
    expect(
      screen
        .getByRole("switch", { name: "Деактивировать 02-прайс.md" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    expect(
      screen
        .getByRole("switch", { name: "Активировать 03-архив.md" })
        .getAttribute("aria-checked"),
    ).toBe("false");
    expect(screen.getByText(/1 активных файлов/)).toBeDefined();
  });

  it("edits Markdown with a rendered preview", async () => {
    render(<KnowledgeBasePanel files={files} />);

    fireEvent.click(screen.getByRole("button", { name: "02-прайс.md" }));
    expect(screen.getByRole("heading", { name: "Редактирование файла" })).toBeDefined();
    expect(screen.getByRole("heading", { name: "Прайс" })).toBeDefined();

    fireEvent.change(screen.getByLabelText("Содержимое Markdown"), {
      target: { value: "# Новый прайс\n\nВаза — 42 €." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));

    await waitFor(() =>
      expect(updateKnowledgeFileAction).toHaveBeenCalledWith({
        id: "kbf_price",
        name: "02-прайс.md",
        content: "# Новый прайс\n\nВаза — 42 €.",
      }),
    );
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("loads an uploaded .md file into the editor and creates it", async () => {
    render(<KnowledgeBasePanel files={files} />);

    const upload = new File(["# FAQ\n\nОтвет"], "04-FAQ.md", {
      type: "text/markdown",
    });
    Object.defineProperty(upload, "text", {
      value: async () => "# FAQ\n\nОтвет",
    });

    fireEvent.change(screen.getByLabelText("Загрузить .md"), {
      target: { files: [upload] },
    });

    expect(await screen.findByDisplayValue("04-FAQ.md")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));

    await waitFor(() =>
      expect(createKnowledgeFileAction).toHaveBeenCalledWith({
        name: "04-FAQ.md",
        content: "# FAQ\n\nОтвет",
      }),
    );
  });

  it("toggles and deletes a file through server actions", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<KnowledgeBasePanel files={files} />);

    fireEvent.click(
      screen.getByRole("switch", { name: "Деактивировать 02-прайс.md" }),
    );
    await waitFor(() =>
      expect(setKnowledgeFileEnabledAction).toHaveBeenCalledWith({
        id: "kbf_price",
        isEnabled: false,
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "02-прайс.md" }));
    fireEvent.click(screen.getByRole("button", { name: "Удалить" }));
    await waitFor(() =>
      expect(deleteKnowledgeFileAction).toHaveBeenCalledWith({ id: "kbf_price" }),
    );

    confirmSpy.mockRestore();
  });
});
