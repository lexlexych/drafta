// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AutoReplyPanel,
  type AutoReplyScenarioView,
} from "./auto-reply-panel";

const saveAutoReplySettingsAction = vi.fn();
const createAutoReplyScenarioAction = vi.fn();
const updateAutoReplyScenarioAction = vi.fn();
const deleteAutoReplyScenarioAction = vi.fn();
const moveAutoReplyScenarioAction = vi.fn();

vi.mock("../auto-reply-actions", () => ({
  saveAutoReplySettingsAction: (...args: unknown[]) =>
    saveAutoReplySettingsAction(...args),
  createAutoReplyScenarioAction: (...args: unknown[]) =>
    createAutoReplyScenarioAction(...args),
  updateAutoReplyScenarioAction: (...args: unknown[]) =>
    updateAutoReplyScenarioAction(...args),
  deleteAutoReplyScenarioAction: (...args: unknown[]) =>
    deleteAutoReplyScenarioAction(...args),
  moveAutoReplyScenarioAction: (...args: unknown[]) =>
    moveAutoReplyScenarioAction(...args),
}));

const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

const showToast = vi.fn();

vi.mock("../../_components/stub", () => ({
  showToast: (...args: unknown[]) => showToast(...args),
}));

const templates = [
  { id: "tpl_prices", name: "Прайс" },
  { id: "tpl_hours", name: "Часы работы" },
];

const scenarios: AutoReplyScenarioView[] = [
  {
    id: "sc_prices",
    name: "Цены",
    condition: "Клиент спрашивает стоимость",
    examples: ["Сколько стоит?"],
    action: "reply",
    replyTemplateId: "tpl_prices",
  },
  {
    id: "sc_spam",
    name: "Спам",
    condition: "Реклама и рассылки",
    examples: ["Предлагаем сотрудничество"],
    action: "ignore",
    replyTemplateId: null,
  },
];

function renderPanel(isEnabled = false) {
  return render(
    <AutoReplyPanel
      settings={{ isEnabled, delayMinutes: 5, fallbackTemplateId: null }}
      scenarios={scenarios}
      templates={templates}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  saveAutoReplySettingsAction.mockResolvedValue({ ok: true, data: {} });
  createAutoReplyScenarioAction.mockResolvedValue({ ok: true, data: {} });
  moveAutoReplyScenarioAction.mockResolvedValue({ ok: true, data: {} });
});

afterEach(cleanup);

describe("AutoReplyPanel", () => {
  it("turns the contour on with the main switch", async () => {
    renderPanel(false);

    fireEvent.click(screen.getByRole("switch", { name: "Включить автоответы" }));

    await waitFor(() => {
      expect(saveAutoReplySettingsAction).toHaveBeenCalledWith(
        expect.objectContaining({ isEnabled: true }),
      );
    });
    // Значок «вкл/выкл» в шапке списка рисует сервер — без refresh он остался
    // бы врать о состоянии.
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("puts the switch back when saving fails", async () => {
    saveAutoReplySettingsAction.mockResolvedValue({
      ok: false,
      error: "Не удалось сохранить настройки автоответов.",
    });
    renderPanel(false);

    fireEvent.click(screen.getByRole("switch", { name: "Включить автоответы" }));

    // Контур, который «вроде включён», а на деле нет, хуже честной ошибки.
    await waitFor(() =>
      expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe(
        "false",
      ),
    );
    expect(showToast).toHaveBeenCalledWith(
      "Не удалось сохранить настройки автоответов.",
    );
  });

  it("saves the delay only when it actually changed", async () => {
    renderPanel(true);
    const delay = screen.getByLabelText("Отвечать через, минут");

    fireEvent.blur(delay);
    expect(saveAutoReplySettingsAction).not.toHaveBeenCalled();

    fireEvent.change(delay, { target: { value: "15" } });
    fireEvent.blur(delay);

    await waitFor(() =>
      expect(saveAutoReplySettingsAction).toHaveBeenCalledWith(
        expect.objectContaining({ delayMinutes: 15 }),
      ),
    );
  });

  it("refuses a delay that is not a whole number of minutes", async () => {
    renderPanel(true);
    const delay = screen.getByLabelText("Отвечать через, минут");

    fireEvent.change(delay, { target: { value: "2.5" } });
    fireEvent.blur(delay);

    expect(saveAutoReplySettingsAction).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(
      "Задержка должна быть целым числом минут.",
    );
  });

  it("shows scenarios in their processing order, with their replies", () => {
    renderPanel(true);

    expect(screen.getByText("Цены")).toBeTruthy();
    expect(screen.getByText("Шаблон: Прайс")).toBeTruthy();
    // «Не отвечать автоматически» — самостоятельное состояние сценария, и
    // список обязан его показывать, а не оставлять пустое место. Тот же текст
    // есть в выпадающем списке «Иначе», поэтому берём все вхождения.
    expect(
      screen.getAllByText("Не отвечать автоматически").length,
    ).toBeGreaterThan(1);
  });

  it("cannot move the first scenario up or the last one down", () => {
    renderPanel(true);

    expect(
      (screen.getByRole("button", {
        name: "Поднять сценарий «Цены»",
      }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", {
        name: "Опустить сценарий «Спам»",
      }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("moves a scenario down the list", async () => {
    renderPanel(true);

    fireEvent.click(
      screen.getByRole("button", { name: "Опустить сценарий «Цены»" }),
    );

    await waitFor(() =>
      expect(moveAutoReplyScenarioAction).toHaveBeenCalledWith("sc_prices", "down"),
    );
  });

  it("refuses a scenario the classifier could not tell apart", async () => {
    renderPanel(true);

    fireEvent.click(screen.getByRole("button", { name: /Добавить/ }));
    fireEvent.change(screen.getByLabelText("Название"), {
      target: { value: "Пустой" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));

    // Сценарий из одного названия попадёт в промпт пустым и будет выбираться
    // наугад.
    await waitFor(() =>
      expect(
        screen.getByText(
          "Опишите условие сценария или добавьте хотя бы один пример.",
        ),
      ).toBeTruthy(),
    );
    expect(createAutoReplyScenarioAction).not.toHaveBeenCalled();
  });

  it("creates a scenario with its condition, examples and template", async () => {
    renderPanel(true);

    fireEvent.click(screen.getByRole("button", { name: /Добавить/ }));
    fireEvent.change(screen.getByLabelText("Название"), {
      target: { value: "Часы" },
    });
    fireEvent.change(
      screen.getByLabelText("Условие: как отличить такие входящие"),
      { target: { value: "Спрашивают режим работы" } },
    );
    fireEvent.change(screen.getByLabelText("Пример 1"), {
      target: { value: "До скольки вы работаете?" },
    });
    fireEvent.change(screen.getByLabelText("Ответ"), {
      target: { value: "tpl_hours" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));

    await waitFor(() =>
      expect(createAutoReplyScenarioAction).toHaveBeenCalledWith({
        name: "Часы",
        condition: "Спрашивают режим работы",
        examples: ["До скольки вы работаете?"],
        action: "reply",
        replyTemplateId: "tpl_hours",
      }),
    );
  });

  it("turns an empty template choice into «не отвечать автоматически»", async () => {
    renderPanel(true);

    fireEvent.click(screen.getByRole("button", { name: /Добавить/ }));
    fireEvent.change(screen.getByLabelText("Название"), {
      target: { value: "Спам-2" },
    });
    fireEvent.change(screen.getByLabelText("Пример 1"), {
      target: { value: "Купите ссылки" },
    });
    fireEvent.change(screen.getByLabelText("Ответ"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));

    await waitFor(() =>
      expect(createAutoReplyScenarioAction).toHaveBeenCalledWith(
        expect.objectContaining({ action: "ignore", replyTemplateId: null }),
      ),
    );
  });

  it("keeps «не отвечать автоматически» as the fallback default", async () => {
    renderPanel(true);

    const fallback = screen.getByLabelText("Шаблон для сценария «Иначе»");
    expect((fallback as HTMLSelectElement).value).toBe("");

    fireEvent.change(fallback, { target: { value: "tpl_prices" } });

    await waitFor(() =>
      expect(saveAutoReplySettingsAction).toHaveBeenCalledWith(
        expect.objectContaining({ fallbackTemplateId: "tpl_prices" }),
      ),
    );
  });
});
