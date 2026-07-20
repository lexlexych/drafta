import { NextResponse, type NextRequest } from "next/server";

import { createServerSupabaseClient } from "@/lib/db/server";

export const dynamic = "force-dynamic";

function redirectToLogin(request: NextRequest): NextResponse {
  const response = NextResponse.redirect(new URL("/login", request.url));

  response.headers.set("Cache-Control", "no-store");

  return response;
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");

  if (!code) {
    return redirectToLogin(request);
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return redirectToLogin(request);
  }

  const response = NextResponse.redirect(
    new URL("/update-password", request.url),
  );

  response.headers.set("Cache-Control", "no-store");

  return response;
}
