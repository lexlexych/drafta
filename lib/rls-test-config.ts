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

const remoteConfirmation = "cloud-dev-only";

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
  if (value.startsWith("sb_secret_")) {
    throw new Error(
      "RLS_TEST_SUPABASE_PUBLISHABLE_KEY must not contain a Supabase secret key",
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
  if (url.protocol !== "https:" || !url.hostname.endsWith(".supabase.co")) {
    throw new Error(
      "RLS_TEST_TARGET=cloud-dev requires an https://<project-ref>.supabase.co URL",
    );
  }

  if (environment.RLS_TEST_REMOTE_CONFIRMATION !== remoteConfirmation) {
    throw new Error(
      `Remote RLS tests require RLS_TEST_REMOTE_CONFIRMATION=${remoteConfirmation}`,
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
