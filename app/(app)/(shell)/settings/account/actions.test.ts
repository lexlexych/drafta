import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
  createServerSupabaseClient: vi.fn(),
  verifyUserPassword: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/workspace", () => ({
  getAuthenticatedUser: mocks.getAuthenticatedUser,
}));
vi.mock("@/lib/db/server", () => ({
  createServerSupabaseClient: mocks.createServerSupabaseClient,
}));
vi.mock("@/lib/auth/verify-password", () => ({
  verifyUserPassword: mocks.verifyUserPassword,
}));

import { changePasswordAction } from "./actions";

function createSupabaseClient(error: { code?: string } | null = null) {
  const updateUser = vi.fn().mockResolvedValue({ data: {}, error });

  return {
    client: { auth: { updateUser } } as unknown as SupabaseClient,
    updateUser,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthenticatedUser.mockResolvedValue({
    id: "user-1",
    email: "owner@example.com",
  });
  mocks.verifyUserPassword.mockResolvedValue(true);
});

describe("changePasswordAction", () => {
  it("updates the password once the current one checks out", async () => {
    const supabase = createSupabaseClient();
    mocks.createServerSupabaseClient.mockResolvedValue(supabase.client);

    const result = await changePasswordAction({
      currentPassword: "old-password",
      newPassword: "new-password",
    });

    expect(result).toEqual({ ok: true });
    expect(mocks.verifyUserPassword).toHaveBeenCalledWith(
      "owner@example.com",
      "old-password",
    );
    expect(supabase.updateUser).toHaveBeenCalledWith({
      password: "new-password",
    });
  });

  it("refuses without a session", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue(null);

    const result = await changePasswordAction({
      currentPassword: "old-password",
      newPassword: "new-password",
    });

    expect(result).toEqual({
      ok: false,
      error: "Сессия истекла — войдите заново.",
    });
    expect(mocks.createServerSupabaseClient).not.toHaveBeenCalled();
  });

  it("refuses when the account has no email to re-authenticate with", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue({ id: "user-1", email: null });

    const result = await changePasswordAction({
      currentPassword: "old-password",
      newPassword: "new-password",
    });

    expect(result).toEqual({
      ok: false,
      error: "У аккаунта нет email — смена пароля недоступна.",
    });
    expect(mocks.verifyUserPassword).not.toHaveBeenCalled();
  });

  it("rejects a too short new password before touching Supabase", async () => {
    const result = await changePasswordAction({
      currentPassword: "old-password",
      newPassword: "short",
    });

    expect(result).toEqual({
      ok: false,
      error: "Пароль должен содержать не менее 8 символов.",
    });
    expect(mocks.verifyUserPassword).not.toHaveBeenCalled();
    expect(mocks.createServerSupabaseClient).not.toHaveBeenCalled();
  });

  it("rejects reusing the current password", async () => {
    const result = await changePasswordAction({
      currentPassword: "same-password",
      newPassword: "same-password",
    });

    expect(result).toEqual({
      ok: false,
      error: "Новый пароль совпадает с текущим.",
    });
    expect(mocks.verifyUserPassword).not.toHaveBeenCalled();
  });

  it("does not update anything when the current password is wrong", async () => {
    const supabase = createSupabaseClient();
    mocks.createServerSupabaseClient.mockResolvedValue(supabase.client);
    mocks.verifyUserPassword.mockResolvedValue(false);

    const result = await changePasswordAction({
      currentPassword: "wrong-password",
      newPassword: "new-password",
    });

    expect(result).toEqual({ ok: false, error: "Текущий пароль неверен." });
    expect(supabase.updateUser).not.toHaveBeenCalled();
  });

  it("translates known Supabase auth errors", async () => {
    const supabase = createSupabaseClient({ code: "weak_password" });
    mocks.createServerSupabaseClient.mockResolvedValue(supabase.client);

    const result = await changePasswordAction({
      currentPassword: "old-password",
      newPassword: "new-password",
    });

    expect(result).toEqual({
      ok: false,
      error: "Пароль слишком простой — выберите другой.",
    });
  });

  it("falls back to a generic message for unknown Supabase auth errors", async () => {
    const supabase = createSupabaseClient({ code: "unexpected_failure" });
    mocks.createServerSupabaseClient.mockResolvedValue(supabase.client);

    const result = await changePasswordAction({
      currentPassword: "old-password",
      newPassword: "new-password",
    });

    expect(result).toEqual({
      ok: false,
      error: "Не удалось обновить пароль. Попробуйте ещё раз.",
    });
  });
});
