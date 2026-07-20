export const emailConfirmationCallbackPath = "/auth/confirm";
export const passwordRecoveryCallbackPath = "/auth/recovery";

type AuthCallbackPath =
  | typeof emailConfirmationCallbackPath
  | typeof passwordRecoveryCallbackPath;

export function createAuthCallbackUrl(
  origin: string,
  path: AuthCallbackPath,
): string {
  return new URL(path, origin).toString();
}
