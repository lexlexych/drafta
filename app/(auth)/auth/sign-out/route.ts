import { NextResponse, type NextRequest } from "next/server";

import { createServerSupabaseClient } from "@/lib/db/server";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();

  await supabase.auth.signOut();

  const response = NextResponse.redirect(new URL("/login", request.url), 303);

  response.headers.set("Cache-Control", "no-store");

  return response;
}
