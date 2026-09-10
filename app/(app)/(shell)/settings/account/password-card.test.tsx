// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const changePasswordAction = vi.fn();

vi.mock("./actions", () => ({
  changePasswordAction: (...args: unknown[]) => changePasswordAction(...args),
}));

import { PasswordCard } from "./password-card";

function open() {
  render(<PasswordCard />);
  fireEvent.click(screen.getByRole("button", { name: /Поменять пароль/ }));
}

function fill({
  current = "old-password",
  next = "new-password",
  confirmation = "new-password",
}: {
  current?: string;
  next?: string;
  confirmation?: string;
} = {}) {
  fireEvent.change(screen.getByLabelText("Текущий пароль"), {
    target: { value: current },
  });
  fireEvent.change(screen.getByLabelText("Новый пароль"), {
    target: { value: next },
  });
  fireEvent.change(screen.getByLabelText("Повторите новый пароль"), {
    target: { value: confirmation },
  });
}

function submit() {
  fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
}

beforeEach(() => {
  changePasswordAction.mockReset();
  changePasswordAction.mockResolvedValue({ ok: true });
});

afterEach(() => {
  cleanup();
});

describe("PasswordCard", () => {
  it("keeps the form collapsed until the button is clicked", () => {
    render(<PasswordCard />);

    expect(screen.queryByLabelText("Текущий пароль")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Поменять пароль/ }));

    expect(screen.getByLabelText("Текущий пароль")).toBeDefined();
    expect(screen.getByLabelText("Новый пароль")).toBeDefined();
    expect(screen.getByLabelText("Повторите новый пароль")).toBeDefined();
  });

  it("does not call the action when the confirmation differs", () => {
    open();
    fill({ confirmation: "other-password" });
    submit();

    expect(screen.getByRole("alert").textContent).toBe("Пароли не совпадают.");
    expect(changePasswordAction).not.toHaveBeenCalled();
  });

  it("does not call the action when the new password is too short", () => {
    open();
    fill({ next: "short", confirmation: "short" });
    submit();

    expect(screen.getByRole("alert").textContent).toContain("не менее 8");
    expect(changePasswordAction).not.toHaveBeenCalled();
  });

  it("does not call the action without the current password", () => {
    open();
    fill({ current: "" });
    submit();

    expect(screen.getByRole("alert").textContent).toBe("Введите текущий пароль.");
    expect(changePasswordAction).not.toHaveBeenCalled();
  });

  it("collapses and confirms after a successful change", async () => {
    open();
    fill();
    submit();

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe("Пароль обновлён.");
    });

    expect(changePasswordAction).toHaveBeenCalledWith({
      currentPassword: "old-password",
      newPassword: "new-password",
    });
    expect(screen.queryByLabelText("Текущий пароль")).toBeNull();
  });

  it("keeps the form open and shows the server error", async () => {
    changePasswordAction.mockResolvedValue({
      ok: false,
      error: "Текущий пароль неверен.",
    });

    open();
    fill();
    submit();

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toBe(
        "Текущий пароль неверен.",
      );
    });

    expect(screen.getByLabelText("Текущий пароль")).toBeDefined();
  });
});
