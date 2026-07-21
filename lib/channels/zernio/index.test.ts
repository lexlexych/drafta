import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * `index.ts` imports "server-only", which throws immediately if evaluated
 * outside a Next.js server compilation (see node_modules/server-only —
 * it's a plain `throw` gated only by the bundler's module-resolution
 * conditions, not by anything Node's module loader understands). So this
 * file can't be dynamically imported here — mirroring how
 * lib/db/auth-boundaries.test.ts verifies lib/db/admin.ts's server-only
 * guard by reading its source rather than importing it.
 */
function readSource(name: string): string {
  return readFileSync(fileURLToPath(new URL(`./${name}`, import.meta.url)), "utf8");
}

describe("Zernio adapter registration (lib/channels/zernio/index.ts)", () => {
  it("guards the Zernio secrets/config behind server-only and registers the adapter as 'zernio'", () => {
    const indexSource = readSource("index.ts");

    expect(indexSource).toContain('import "server-only";');
    expect(indexSource).toContain("process.env.ZERNIO_WEBHOOK_SECRET");
    // Account-connect (OAuth) REST config is read here too, behind the same guard.
    expect(indexSource).toContain("process.env.ZERNIO_API_BASE_URL");
    expect(indexSource).toContain("process.env.ZERNIO_API_KEY");
    expect(indexSource).toContain("createZernioAdapter(");
    expect(indexSource).toContain("getZernioWebhookSecret");
    expect(indexSource).toContain("getZernioApiConfig");
    expect(indexSource).toContain("registerChannelAdapter(zernioAdapter)");
  });

  it("keeps the adapter factory itself free of the server-only guard, so it stays unit-testable", () => {
    // The file may still *mention* "server-only" in prose comments
    // (explaining why the guard lives in ./index.ts instead) — what must
    // never appear is an actual `import "server-only";` statement, which
    // would make adapter.ts (and adapter.test.ts's dynamic import of it)
    // throw outside a Next.js server compilation. That adapter.ts never
    // reads `process.env` itself is verified behaviorally, not textually —
    // adapter.test.ts constructs it with only an injected secret getter and
    // exercises every operation through it.
    const adapterSource = readSource("adapter.ts");

    expect(adapterSource).not.toMatch(/^\s*import\s+"server-only";/m);
  });
});
