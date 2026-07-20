import { approvedRlsTestCloudDevProjectRefs } from "./rls-test-targets";

export type RlsTestConfig = {
  ownerAPassword: string;
  ownerBPassword: string;
  publishableKey: string;
  target: "cloud-dev" | "local";
  url: string;
};

type Environment = Record<string, string | undefined>;

const requiredVariableNames = [
  "RLS_TEST_TARGET",
  "RLS_TEST_SUPABASE_URL",
  "RLS_TEST_SUPABASE_PUBLISHABLE_KEY",
  "RLS_TEST_USER_A_PASSWORD",
  "RLS_TEST_USER_B_PASSWORD",
] as const;

const cloudProjectRefPattern = /^[a-z0-9]{20}$/;
const publishableKeyPrefix = "sb_publishable_";

function getRequiredVariable(name: string, environment: Environment): string {
  const value = environment[name];

  if (!value) {
    throw new Error(`Missing required RLS test environment variable: ${name}`);
  }

  return value;
}

function getRlsTestUrl(value: string): URL {
  try {
    return new URL(value);
  } catch {
    throw new Error("RLS_TEST_SUPABASE_URL must be a valid URL");
  }
}

function assertPublishableKey(value: string): void {
  if (
    !value.startsWith(publishableKeyPrefix) ||
    value.length === publishableKeyPrefix.length ||
    /\s/.test(value)
  ) {
    throw new Error(
      "RLS_TEST_SUPABASE_PUBLISHABLE_KEY must be a non-empty sb_publishable_ key",
    );
  }
}

function assertLocalTarget(url: URL): void {
  const isLoopbackHost =
    url.hostname === "127.0.0.1" ||
    url.hostname === "localhost" ||
    url.hostname === "::1";

  if (!isLoopbackHost || url.port !== "54321") {
    throw new Error(
      "RLS_TEST_TARGET=local only permits http://127.0.0.1:54321 or http://localhost:54321",
    );
  }

  if (url.protocol !== "http:") {
    throw new Error("RLS_TEST_TARGET=local requires an http URL");
  }
}

function assertCloudDevTarget(url: URL, environment: Environment): void {
  const cloudHostSuffix = ".supabase.co";

  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    !url.hostname.endsWith(cloudHostSuffix)
  ) {
    throw new Error(
      "RLS_TEST_SUPABASE_URL must be an exact https://<project-ref>.supabase.co URL",
    );
  }

  const devProjectRef = url.hostname.slice(0, -cloudHostSuffix.length);

  if (!cloudProjectRefPattern.test(devProjectRef)) {
    throw new Error(
      "RLS_TEST_SUPABASE_URL must contain a lowercase 20-character Supabase project ref",
    );
  }

  const expectedUrl = `https://${devProjectRef}.supabase.co`;

  if (
    url.toString() !== `${expectedUrl}/` ||
    url.username ||
    url.password
  ) {
    throw new Error(
      `RLS_TEST_SUPABASE_URL must exactly equal ${expectedUrl}`,
    );
  }

  if (!approvedRlsTestCloudDevProjectRefs.includes(devProjectRef)) {
    throw new Error(
      "RLS_TEST_SUPABASE_URL project ref is not an approved Cloud dev target. Add it to lib/rls-test-targets.ts through the reviewed T-08 procedure.",
    );
  }

  const expectedConfirmation = `cloud-dev:${devProjectRef}`;

  if (environment.RLS_TEST_REMOTE_CONFIRMATION !== expectedConfirmation) {
    throw new Error(
      `Remote RLS tests require RLS_TEST_REMOTE_CONFIRMATION=${expectedConfirmation}`,
    );
  }
}

export function getRlsTestConfig(
  environment: Environment = process.env,
): RlsTestConfig {
  for (const variableName of requiredVariableNames) {
    getRequiredVariable(variableName, environment);
  }

  const target = getRequiredVariable("RLS_TEST_TARGET", environment);
  const url = getRlsTestUrl(
    getRequiredVariable("RLS_TEST_SUPABASE_URL", environment),
  );
  const publishableKey = getRequiredVariable(
    "RLS_TEST_SUPABASE_PUBLISHABLE_KEY",
    environment,
  );

  assertPublishableKey(publishableKey);

  if (target === "local") {
    assertLocalTarget(url);
  } else if (target === "cloud-dev") {
    assertCloudDevTarget(url, environment);
  } else {
    throw new Error(
      'RLS_TEST_TARGET must be either "local" or "cloud-dev"',
    );
  }

  return {
    ownerAPassword: getRequiredVariable("RLS_TEST_USER_A_PASSWORD", environment),
    ownerBPassword: getRequiredVariable("RLS_TEST_USER_B_PASSWORD", environment),
    publishableKey,
    target,
    url: url.toString().replace(/\/$/, ""),
  };
}
