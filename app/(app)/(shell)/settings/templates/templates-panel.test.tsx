// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ReplyTemplatesPanel,
  type ReplyTemplateListItem,
} from "./templates-panel";

const createReplyTemplateAction = vi.fn();
const updateReplyTemplateAction = vi.fn();
const deleteReplyTemplateAction = vi.fn();

vi.mock("./actions", () => ({
  createReplyTemplateAction: (...args: unknown[]) =>
    createReplyTemplateAction(...args),
  updateReplyTemplateAction: (...args: unknown[]) =>
    updateReplyTemplateAction(...args),
  deleteReplyTemplateAction: (...args: unknown[]) =>
    deleteReplyTemplateAction(...args),
}));

const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

const templates: ReplyTemplateListItem[] = [
  {
    id: "tpl_shipping",
    name: "Сроки доставки",
    bodies: { de: "Zwei Werktage.", en: "Two business days." },
    isEnabledForMessages: true,
    isEnabledForComments: false,
    updated_at: "2026-08-20T10:00:00.000Z",
  },
  {
    id: "tpl_thanks",
    name: "Спасибо за заказ",
    bodies: { de: "Danke!" },
    isEnabledForMessages: true,
    isEnabledForComments: true,
    updated_at: "2026-08-21T10:00:00.000Z",
  },
];

const bodyField = () =>
  screen.getByPlaceholderText(
    "Текст, который оператор отправит клиенту на этом языке.",
  );

function renderPanel(items: ReplyTemplateListItem[] = templates) {
  return render(
    <ReplyTemplatesPanel templates={items} workspaceLanguage="de" />,
  );
}

beforeEach(() => {
  createReplyTemplateAction.mockResolvedValue({ ok: true, data: {} });
  updateReplyTemplateAction.mockResolvedValue({ ok: true, data: {} });
  deleteReplyTemplateAction.mockResolvedValue({ ok: true, data: null });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ReplyTemplatesPanel", () => {
  it("показывает дату изменения и значки типов", () => {
    renderPanel();

    expect(screen.getByText(/обновлён 20 августа 2026/)).toBeTruthy();
    // Первый шаблон только для сообщений, второй — и для комментариев.
    expect(screen.getAllByText("Активен для сообщений")).toHaveLength(2);
    expect(screen.getAllByText("Активен для комментариев")).toHaveLength(1);
  });

  it("открывает новый шаблон на языке из настроек аккаунта", () => {
    renderPanel([]);

    expect(screen.getByText("Шаблонов пока нет")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "+ Новый шаблон" }));

    expect(screen.getByRole("tab", { name: "Deutsch" })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "English" })).toBeNull();
    // Единственный язык удалить нельзя — вкладке нужен хотя бы один.
    expect(screen.queryByRole("button", { name: /Удалить язык/ })).toBeNull();
  });

  it("добавляет язык вкладкой и сохраняет тексты обоих языков", async () => {
    renderPanel([]);
    fireEvent.click(screen.getByRole("button", { name: "+ Новый шаблон" }));

    fireEvent.change(bodyField(), {
      target: { value: "Zwei Werktage." },
    });
    fireEvent.change(screen.getByPlaceholderText("например, Сроки доставки"), {
      target: { value: "Сроки доставки" },
    });

    fireEvent.change(screen.getByRole("combobox", { name: "Добавить язык" }), {
      target: { value: "en" },
    });

    // Новая вкладка открывается сразу — текст набирают именно на ней.
    expect(
      screen.getByRole("tab", { name: "English" }).getAttribute("aria-selected"),
    ).toBe("true");
    fireEvent.change(bodyField(), {
      target: { value: "Two business days." },
    });

    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));

    await waitFor(() => {
      expect(createReplyTemplateAction).toHaveBeenCalledWith({
        name: "Сроки доставки",
        bodies: { de: "Zwei Werktage.", en: "Two business days." },
        isEnabledForMessages: true,
        isEnabledForComments: false,
      });
    });
  });

  it("удаляет язык вместе с его текстом", async () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Сроки доставки" }));

    fireEvent.click(
      screen.getByRole("button", { name: "Удалить язык: English" }),
    );
    // Текст на английском был непустым — подтверждения тут не мокаем, значит
    // jsdom вернёт false и язык останется.
    expect(screen.getByRole("tab", { name: "English" })).toBeTruthy();

    vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(
      screen.getByRole("button", { name: "Удалить язык: English" }),
    );
    expect(screen.queryByRole("tab", { name: "English" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));

    await waitFor(() => {
      expect(updateReplyTemplateAction).toHaveBeenCalledWith({
        id: "tpl_shipping",
        name: "Сроки доставки",
        bodies: { de: "Zwei Werktage." },
        isEnabledForMessages: true,
        isEnabledForComments: false,
      });
    });
  });

  it("сохраняет оба переключателя активности", async () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Сроки доставки" }));

    fireEvent.click(
      screen.getByRole("switch", { name: /Активировать шаблон для: Комментарии/ }),
    );
    fireEvent.click(
      screen.getByRole("switch", { name: /Деактивировать шаблон для: Сообщения/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));

    await waitFor(() => {
      expect(updateReplyTemplateAction).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "tpl_shipping",
          isEnabledForMessages: false,
          isEnabledForComments: true,
        }),
      );
    });
  });

  it("не отправляет шаблон без названия", () => {
    renderPanel([]);
    fireEvent.click(screen.getByRole("button", { name: "+ Новый шаблон" }));
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));

    expect(screen.getByRole("alert").textContent).toContain("название");
    expect(createReplyTemplateAction).not.toHaveBeenCalled();
  });
});
