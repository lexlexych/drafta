import { NextResponse, type NextRequest } from "next/server";

import { createServerSupabaseClient } from "@/lib/db/server";

/** A profile picture is small; anything larger is not one and gets dropped. */
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 5_000;

/**
 * `GET /api/avatars/[identityId]` — the only way a contact's profile picture
 * reaches the browser.
 *
 * The platform CDN URL that Zernio reports (`contact_identities.avatar_url`) is
 * never rendered directly, for two reasons:
 *
 * 1. GDPR (docs/architecture/15-compliance-gdpr.md): an `<img>` pointing at
 *    Meta would send every operator's IP and referrer to Meta on each render.
 *    Here the fetch happens server-side, so nothing about the operator leaves
 *    our infrastructure.
 * 2. Those links expire. Every failure path below answers 404, and the UI's
 *    initials sit underneath the image (`_components/avatar.tsx`), so an
 *    expired link degrades to the old placeholder instead of a broken image.
 *
 * Authorization is RLS: the query runs on the user's own Supabase session, so
 * an identity from another workspace simply isn't found — there is no separate
 * ownership check to keep in sync.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ identityId: string }> },
): Promise<NextResponse> {
  const { identityId } = await params;

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("contact_identities")
    .select("avatar_url")
    .eq("id", identityId)
    .maybeSingle();

  if (error || !data?.avatar_url) {
    return notFound();
  }

  let source: URL;
  try {
    source = new URL(data.avatar_url);
  } catch {
    return notFound();
  }

  // Only ever call out to https, so a stored value can't be turned into a
  // request against an internal address or a file:// read.
  if (source.protocol !== "https:") {
    return notFound();
  }

  let upstream: Response;
  try {
    upstream = await fetch(source, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: "follow",
      cache: "no-store",
    });
  } catch {
    return notFound();
  }

  const contentType = upstream.headers.get("content-type") ?? "";
  if (!upstream.ok || !contentType.startsWith("image/")) {
    return notFound();
  }

  const declaredLength = Number(upstream.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_AVATAR_BYTES) {
    return notFound();
  }

  const body = await upstream.arrayBuffer();
  if (body.byteLength > MAX_AVATAR_BYTES) {
    return notFound();
  }

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(body.byteLength),
      // Private: the response is scoped to one workspace's contact, so it must
      // never land in a shared cache. The URL carries a `v` fingerprint of the
      // stored link (lib/avatars.ts), so a changed photo busts this cache.
      "Cache-Control": "private, max-age=86400, stale-while-revalidate=604800",
    },
  });
}

function notFound(): NextResponse {
  return new NextResponse(null, { status: 404 });
}
