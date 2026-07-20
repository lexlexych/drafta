import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const dbDirectory = join(process.cwd(), "lib", "db");

function readDbFile(name: string): string {
  return readFileSync(join(dbDirectory, name), "utf8");
}

describe("Supabase client boundaries", () => {
  it("keeps the secret key behind a server-only admin module", () => {
    const adminSource = readDbFile("admin.ts");
    const browserSource = readDbFile("browser.ts");
    const serverSource = readDbFile("server.ts");

    expect(adminSource).toContain('import "server-only";');
    expect(adminSource).toContain("process.env.SUPABASE_SECRET_KEY");
    expect(browserSource).not.toContain("SUPABASE_SECRET_KEY");
    expect(serverSource).not.toContain("SUPABASE_SECRET_KEY");
  });

  it("uses the current SSR cookie adapter and verified claims in the Proxy", () => {
    const proxySource = readDbFile("proxy.ts");
    const allDbSources = ["admin.ts", "browser.ts", "proxy.ts", "server.ts"]
      .map(readDbFile)
      .join("\n");

    expect(proxySource).toContain("getAll() {");
    expect(proxySource).toContain("setAll(cookiesToSet, headers)");
    expect(proxySource).toContain("supabase.auth.getClaims()");
    expect(allDbSources).not.toContain("@supabase/auth-helpers");
  });
});
