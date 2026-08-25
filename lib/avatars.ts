const TRUSTED_AVATAR_HOST_SUFFIXES = ["cdninstagram.com", "fbcdn.net"];

export const AVATAR_TTL_DAYS = 7;

export function isAvatarStale(
  fetchedAt: string | null | undefined,
  now = new Date(),
): boolean {
  if (!fetchedAt) {
    return true;
  }

  const timestamp = Date.parse(fetchedAt);
  if (!Number.isFinite(timestamp)) {
    return true;
  }

  return now.getTime() - timestamp >= AVATAR_TTL_DAYS * 24 * 60 * 60 * 1_000;
}

export function avatarProxyUrl(
  contactIdentityId: string,
  avatarUrl: string | null | undefined,
  version?: string | null,
): string | null {
  if (!avatarUrl) {
    return null;
  }

  const fingerprint = simpleFingerprint(`${avatarUrl}:${version ?? ""}`);
  return `/api/avatars/${encodeURIComponent(contactIdentityId)}?v=${fingerprint}`;
}

export function isAllowedAvatarSource(value: string | URL): boolean {
  let url: URL;
  try {
    url = typeof value === "string" ? new URL(value) : value;
  } catch {
    return false;
  }

  if (
    url.protocol !== "https:" ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    (url.port.length > 0 && url.port !== "443")
  ) {
    return false;
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  return TRUSTED_AVATAR_HOST_SUFFIXES.some(
    (suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`),
  );
}

function simpleFingerprint(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
