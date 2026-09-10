"use server";

import { validateNewPassword } from "@/lib/auth/password";
import { verifyUserPassword } from "@/lib/auth/verify-password";
import { createServerSupabaseClient } from "@/lib/db/server";
import { getAuthenticatedUser } from "@/lib/db/workspace";

export type ChangePasswordResult = { ok: true } | { ok: false; error: string };

export type ChangePasswordInput = {
  currentPassword: string;
  newPassword: string;
};

/**
 * Supabase отдаёт ошибки Auth по-английски, а раздел настроек говорит
 * по-русски. Переводим только то, что пользователь реально может увидеть при
 * смене пароля; остальное сворачивается в общий текст, чтобы наружу не утекали
 * технические подробности.
 */
function translateUpdateError(code: string | undefined): string {
  switch (code) {
    case "weak_password":
      return "Пароль слишком простой — выберите другой.";
    case "same_password":
      return "Новый пароль совпадает с текущим.";
    case "over_request_rate_limit":
      return "Слишком много попыток. Подождите немного и попробуйте снова.";
    default:
      return "Не удалось обновить пароль. Попробуйте ещё раз.";
  }
}

/**
 * Смена пароля из раздела «Аккаунт». Текущий пароль обязателен: без него любой,
 * кому досталась открытая сессия, забрал бы аккаунт себе. Сессия после смены
 * сохраняется — `updateUser` сам обновляет cookie-токены.
 */
export async function changePasswordAction(
  input: ChangePasswordInput,
): Promise<ChangePasswordResult> {
  const user = await getAuthenticatedUser();

  if (!user) {
    return { ok: false, error: "Сессия истекла — войдите заново." };
  }

  if (!user.email) {
    return { ok: false, error: "У аккаунта нет email — смена пароля недоступна." };
  }

  // Повтор сверяет форма, сюда приходит уже один пароль — валидатору отдаём его
  // же вторым аргументом, чтобы проверить только длину.
  const validation = validateNewPassword(input.newPassword, input.newPassword);

  if (!validation.ok) {
    return validation;
  }

  if (input.newPassword === input.currentPassword) {
    return { ok: false, error: "Новый пароль совпадает с текущим." };
  }

  const isCurrentPasswordValid = await verifyUserPassword(
    user.email,
    input.currentPassword,
  );

  if (!isCurrentPasswordValid) {
    return { ok: false, error: "Текущий пароль неверен." };
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.updateUser({
    password: input.newPassword,
  });

  if (error) {
    return { ok: false, error: translateUpdateError(error.code) };
  }

  return { ok: true };
}
