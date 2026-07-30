/**
 * Links to a contact's profile picture always point at our own proxy route
 * (`app/api/avatars/[identityId]/route.ts`), never at the platform CDN — the
 * route explains why. This helper is the single place that builds them, so the
 * inbox, the contacts screen and the comments screen can't drift apart.
 */

/**
 * Fingerprint of the stored link, appended as `?v=`. Contacts change their
 * photo, and the URL Zernio reports changes with it, but the proxy URL is keyed
 * by identity id alone — without this the browser would keep serving the
 * previous picture out of its private cache for a day.
 */
function fingerprint(avatarUrl: string): string {
  let hash = 0;

  for (let index = 0; index < avatarUrl.length; index += 1) {
    hash = (Math.imul(hash, 31) + avatarUrl.charCodeAt(index)) | 0;
  }

  return (hash >>> 0).toString(36);
}

/**
 * @param identityId `contact_identities.id` — what the proxy route resolves.
 * @param avatarUrl the stored provider link; `null` when the platform reported
 *   none, which is the normal case and simply means "render initials".
 */
export function avatarProxyUrl(
  identityId: string,
  avatarUrl: string | null | undefined,
): string | null {
  const stored = avatarUrl?.trim();

  if (!stored) {
    return null;
  }

  return `/api/avatars/${identityId}?v=${fingerprint(stored)}`;
}
