import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { defaultAuthenticatedPath } from "@/lib/auth/redirects";
import { getSupabasePublicConfig } from "@/lib/db/env";

const authenticationPagePaths = new Set([
  "/login",
  "/sign-up",
  "/forgot-password",
]);

const unauthenticatedPaths = new Set([
  ...authenticationPagePaths,
  "/update-password",
  "/auth/confirm",
  "/auth/recovery",
  "/auth/sign-out",
]);

function responseWithSupabaseCookies(
  destination: URL,
  supabaseResponse: NextResponse,
): NextResponse {
  const response = NextResponse.redirect(destination);

  supabaseResponse.cookies.getAll().forEach((cookie) => {
    response.cookies.set(cookie);
  });

  supabaseResponse.headers.forEach((value, key) => {
    if (key.toLowerCase() !== "set-cookie") {
      response.headers.set(key, value);
    }
  });

  return response;
}

export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let supabaseResponse = NextResponse.next({ request });
  const { publishableKey, url } = getSupabasePublicConfig();

  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });

        supabaseResponse = NextResponse.next({ request });

        cookiesToSet.forEach(({ name, options, value }) => {
          supabaseResponse.cookies.set(name, value, options);
        });

        Object.entries(headers).forEach(([key, value]) => {
          supabaseResponse.headers.set(key, value);
        });
      },
    },
  });

  const { data: claimsData } = await supabase.auth.getClaims();
  const pathname = request.nextUrl.pathname;
  const hasAuthenticatedSession = Boolean(claimsData?.claims.sub);

  if (!hasAuthenticatedSession && !unauthenticatedPaths.has(pathname)) {
    const loginUrl = request.nextUrl.clone();

    loginUrl.pathname = "/login";
    loginUrl.search = "";
    loginUrl.searchParams.set(
      "next",
      `${request.nextUrl.pathname}${request.nextUrl.search}`,
    );

    return responseWithSupabaseCookies(loginUrl, supabaseResponse);
  }

  if (
    hasAuthenticatedSession &&
    (authenticationPagePaths.has(pathname) || pathname === "/")
  ) {
    const dashboardUrl = request.nextUrl.clone();

    dashboardUrl.pathname = defaultAuthenticatedPath;
    dashboardUrl.search = "";

    return responseWithSupabaseCookies(dashboardUrl, supabaseResponse);
  }

  return supabaseResponse;
}
