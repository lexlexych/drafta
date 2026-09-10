/**
 * Требования к паролю в одном месте: порог и тексты нужны и клиентской форме,
 * и server action'у, а раньше они копировались по формам (`(auth)/_components`).
 * Модуль намеренно без `server-only` — иначе его не импортировать в браузерный
 * компонент, и проверка снова разъехалась бы на две.
 *
 * Порог строже серверного `minimum_password_length` из `supabase/config.toml`;
 * что он не может оказаться слабее, проверяет `password.test.ts`.
 */

export const MIN_PASSWORD_LENGTH = 8;

export type PasswordValidationResult = { ok: true } | { ok: false; error: string };

export function validateNewPassword(
  password: string,
  confirmation: string,
): PasswordValidationResult {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return {
      ok: false,
      error: `Пароль должен содержать не менее ${MIN_PASSWORD_LENGTH} символов.`,
    };
  }

  if (password !== confirmation) {
    return { ok: false, error: "Пароли не совпадают." };
  }

  return { ok: true };
}
