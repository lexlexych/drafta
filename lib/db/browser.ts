"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getSupabasePublicConfig } from "@/lib/db/env";

let browserClient: SupabaseClient | undefined;

export function createBrowserSupabaseClient(): SupabaseClient {
  if (!browserClient) {
    const { publishableKey, url } = getSupabasePublicConfig();

    browserClient = createBrowserClient(url, publishableKey);
  }

  return browserClient;
}
