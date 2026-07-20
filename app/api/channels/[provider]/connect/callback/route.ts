import { NextResponse, type NextRequest } from "next/server";

// Side-effect import: registers the Zernio adapter under the "zernio"
// provider name (lib/channels/registry.ts) so `resolveChannelAdapter` finds
// its `parseConnectCallback` — same registration the webhook route relies on.
import "@/lib/channels/zernio";
import {
  resolveChannelAdapter,
  UnknownChannelProviderError,
} from "@/lib/channels/registry";
import {
  CONNECT_STATE_NONCE_COOKIE,
  verifyConnectState,
} from "@/lib/channels/connect-state";
import { createChannelConnection } from "@/lib/db/channel-connections";
import { createServerSupabaseClient } from "@/lib/db/server";

export const dynamic = "force-dynamic";

/**
 * `GET /api/channels/[provider]/connect/callback` — where the provider's
 * hosted account-connect (OAuth) flow redirects the browser back once the
 * user authorized their account (docs/architecture/05-channels.md).
 *
 * It verifies the signed `state` (+ the httpOnly nonce cookie set by
 * `startChannelConnectionAction`), asks the provider's adapter to turn its
 * callback query into the connected account's external ID
 * (`parseConnectCallback` — provider-specific parsing stays in
 * `lib/channels/<provider>/`, rule 4), creates the `channel_connections` row
 * under the user's RLS session, and redirects back to Settings → Channels
 * with a result banner. The user never touches the provider's own dashboard.
 *
 * Mirrors the auth-callback pattern in app/(auth)/auth/confirm/route.ts
 * (force-dynamic, redirects built from `request.url`).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
): Promise<NextResponse> {
  const { provider } = await params;
  const searchParams = request.nextUrl.searchParams;

  const state = searchParams.get("state");
  if (!state) {
    return redirectToChannels(request, "error", "state");
  }

  const verified = verifyConnectState(state);
  if (!verified.ok) {
    return redirectToChannels(request, "error", "state");
  }

  // CSRF: the state's nonce must match the httpOnly cookie planted when the
  // flow started — a state minted for someone else won't have the cookie.
  const cookieNonce = request.cookies.get(CONNECT_STATE_NONCE_COOKIE)?.value;
  if (!cookieNonce || cookieNonce !== verified.state.nonce) {
    return redirectToChannels(request, "error", "state");
  }

  let adapter;
  try {
    adapter = resolveChannelAdapter(provider);
  } catch (error) {
    if (error instanceof UnknownChannelProviderError) {
      return redirectToChannels(request, "error", "provider");
    }
    throw error;
  }

  if (!adapter.parseConnectCallback) {
    return redirectToChannels(request, "error", "provider");
  }

  const query = Object.fromEntries(searchParams.entries());

  let externalAccountId: string;
  try {
    ({ externalAccountId } = await adapter.parseConnectCallback({ query }));
  } catch (error) {
    console.error(
      `[channels/${provider}] connect callback did not yield an account`,
      error,
    );
    return redirectToChannels(request, "error", "callback");
  }

  const supabase = await createServerSupabaseClient();
  const result = await createChannelConnection(supabase, verified.state.workspaceId, {
    provider,
    platform: verified.state.platform,
    externalId: externalAccountId,
    name: verified.state.name,
  });

  if (!result.ok) {
    // A duplicate (workspace, provider, external_id) is the one expected
    // business error; everything else (e.g. RLS rejecting because the session
    // isn't a member) is a generic failure.
    const reason = /уже подключён/.test(result.error) ? "duplicate" : "failed";
    return redirectToChannels(request, "error", reason);
  }

  return redirectToChannels(request, "connected");
}

/**
 * Redirects to Settings → Channels with a result banner, always clearing the
 * single-use nonce cookie on the way out.
 */
function redirectToChannels(
  request: NextRequest,
  connect: "connected" | "error",
  reason?: string,
): NextResponse {
  const url = new URL("/settings", request.url);
  url.searchParams.set("section", "channels");
  url.searchParams.set("connect", connect);
  if (reason) {
    url.searchParams.set("reason", reason);
  }

  const response = NextResponse.redirect(url);
  response.headers.set("Cache-Control", "no-store");
  response.cookies.set(CONNECT_STATE_NONCE_COOKIE, "", {
    maxAge: 0,
    path: "/",
  });

  return response;
}
