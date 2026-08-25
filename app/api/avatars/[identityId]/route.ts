import { NextResponse, type NextRequest } from "next/server";

import { isAllowedAvatarSource } from "@/lib/avatars";
import { createServerSupabaseClient } from "@/lib/db/server";

const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 5_000;
const MAX_REDIRECTS = 3;
const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

/**
 * Authenticated proxy for provider-hosted contact pictures. The browser never
 * receives Meta's signed CDN URL, so it does not disclose the operator's IP or
 * referrer to Meta. RLS makes identities from other workspaces invisible.
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

  const upstream = await fetchTrustedAvatar(data.avatar_url);
  if (!upstream?.ok) {
    return notFound();
  }

  const contentType = (upstream.headers.get("content-type") ?? "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (!ALLOWED_IMAGE_TYPES.has(contentType)) {
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
      "Cache-Control": "private, max-age=86400, stale-while-revalidate=604800",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function fetchTrustedAvatar(value: string): Promise<Response | null> {
  let source: URL;
  try {
    source = new URL(value);
  } catch {
    return null;
  }

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    if (!isAllowedAvatarSource(source)) {
      return null;
    }

    let response: Response;
    try {
      response = await fetch(source, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        redirect: "manual",
        cache: "no-store",
      });
    } catch {
      return null;
    }

    if (response.status < 300 || response.status >= 400) {
      return response;
    }

    const location = response.headers.get("location");
    if (!location || redirectCount === MAX_REDIRECTS) {
      return null;
    }
    try {
      source = new URL(location, source);
    } catch {
      return null;
    }
  }

  return null;
}

function notFound(): NextResponse {
  return new NextResponse(null, {
    status: 404,
    headers: { "Cache-Control": "private, no-store" },
  });
}
