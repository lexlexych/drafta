// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createIgnoredSenderAction = vi.fn();
const updateIgnoredSenderAction = vi.fn();
const deleteIgnoredSenderAction = vi.fn();

vi.mock("./actions", () => ({
  createIgnoredSenderAction: (...args: unknown[]) =>
    createIgnoredSenderAction(...args),
  updateIgnoredSenderAction: (...args: unknown[]) =>
    updateIgnoredSenderAction(...args),
  deleteIgnoredSenderAction: (...args: unknown[]) =>
    deleteIgnoredSenderAction(...args),
}));

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { IgnoredSendersField, type IgnoredSenderListItem } from "./ignored-senders";

const anna: IgnoredSenderListItem = {
  id: "ign_1",
  platform: "whatsapp",
  identifier: "491512345678",
  label: "Анна",
};

/** Без подписи — чип показывает один адрес. */
const unnamed: IgnoredSenderListItem = {
  id: "ign_2",
  platform: "whatsapp",
  identifier: "491599887766",
  label: "",
};

beforeEach(() => {
  createIgnoredSenderAction.mockResolvedValue({ ok: true, data: {} });
  updateIgnoredSenderAction.mockResolvedValue({ ok: true, data: {} });
  deleteIgnoredSenderAction.mockResolvedValue({ ok: true, data: { id: "ign_1" } });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("IgnoredSendersField", () => {
  it("показывает чипы «Имя: адрес», а без имени — один адрес", () => {
    render(
      <IgnoredSendersField platform="whatsapp" entries={[anna, unnamed]} />,
    );

    expect(screen.getByText("Анна: +491512345678")).toBeTruthy();
    expect(screen.getByText("+491599887766")).toBeTruthy();
  });

  it("одевает хэндл Instagram обратно в «@»", () => {
    render(
      <IgnoredSendersField
        platform="instagram"
        entries={[
          { id: "ign_3", platform: "instagram", identifier: "lena.fischer", label: "" },
        ]}
      />,
    );

    expect(screen.getByText("@lena.fischer")).toBeTruthy();
  });

  it("карандаш открывает редактор с уже заполненными полями", () => {
    render(<IgnoredSendersField platform="whatsapp" entries={[anna]} />);

    fireEvent.click(screen.getByLabelText("Изменить исключение «Анна: +491512345678»"));

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect((screen.getByDisplayValue("Анна") as HTMLInputElement).value).toBe("Анна");
    expect(screen.getByDisplayValue("+491512345678")).toBeTruthy();
  });

  it("сохраняет новый номер нормализованным", async () => {
    render(<IgnoredSendersField platform="whatsapp" entries={[]} />);

    fireEvent.click(screen.getByRole("button", { name: /Добавить номер/ }));
    fireEvent.change(screen.getByPlaceholderText("например, Анна"), {
      target: { value: "Анна" },
    });
    fireEvent.change(screen.getByPlaceholderText("+49 151 2345678"), {
      target: { value: "+49 151 2345678" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));

    await waitFor(() =>
      expect(createIgnoredSenderAction).toHaveBeenCalledWith({
        platform: "whatsapp",
        identifier: "491512345678",
        label: "Анна",
      }),
    );
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("не зовёт экшен на невалидном номере и оставляет редактор открытым", async () => {
    render(<IgnoredSendersField platform="whatsapp" entries={[]} />);

    fireEvent.click(screen.getByRole("button", { name: /Добавить номер/ }));
    fireEvent.change(screen.getByPlaceholderText("+49 151 2345678"), {
      target: { value: "0151 2345678" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("международном формате"),
    );
    expect(createIgnoredSenderAction).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("показывает ошибку сервера, не закрывая редактор", async () => {
    createIgnoredSenderAction.mockResolvedValue({
      ok: false,
      error: "Этот номер уже в списке исключений.",
    });

    render(<IgnoredSendersField platform="whatsapp" entries={[]} />);

    fireEvent.click(screen.getByRole("button", { name: /Добавить номер/ }));
    fireEvent.change(screen.getByPlaceholderText("+49 151 2345678"), {
      target: { value: "+491512345678" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("уже в списке"),
    );
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("удаляет только после подтверждения", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);

    render(<IgnoredSendersField platform="whatsapp" entries={[anna]} />);
    fireEvent.click(screen.getByLabelText("Изменить исключение «Анна: +491512345678»"));
    fireEvent.click(screen.getByRole("button", { name: "Удалить" }));

    expect(deleteIgnoredSenderAction).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Удалить" }));

    await waitFor(() =>
      expect(deleteIgnoredSenderAction).toHaveBeenCalledWith({ id: "ign_1" }),
    );

    confirm.mockRestore();
  });

  it("у новой записи кнопки удаления нет", () => {
    render(<IgnoredSendersField platform="whatsapp" entries={[]} />);

    fireEvent.click(screen.getByRole("button", { name: /Добавить номер/ }));

    expect(screen.queryByRole("button", { name: "Удалить" })).toBeNull();
  });

  it("закрывается по клику мимо диалога, но не внутри него", () => {
    render(<IgnoredSendersField platform="whatsapp" entries={[anna]} />);
    fireEvent.click(screen.getByLabelText("Изменить исключение «Анна: +491512345678»"));

    fireEvent.mouseDown(screen.getByRole("dialog"));
    expect(screen.getByRole("dialog")).toBeTruthy();

    fireEvent.mouseDown(screen.getByRole("presentation"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
