export const defaultAuthenticatedPath = "/dashboard";

export function getSafeRedirectPath(
  value: string | null,
  fallback = defaultAuthenticatedPath,
): string {
  if (!value) {
    return fallback;
  }

  try {
    const applicationOrigin = "https://drafta.invalid";
    const redirectUrl = new URL(value, applicationOrigin);

    if (redirectUrl.origin !== applicationOrigin) {
      return fallback;
    }

    return `${redirectUrl.pathname}${redirectUrl.search}${redirectUrl.hash}`;
  } catch {
    return fallback;
  }
}
