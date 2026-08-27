import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const projectRoot = path.resolve(import.meta.dirname, "..");
const readProjectFile = (relativePath) =>
  readFile(path.join(projectRoot, relativePath), "utf8");

test("Sentry is installed and wired into every Next.js runtime", async () => {
  const packageJson = JSON.parse(await readProjectFile("next_app/package.json"));
  const nextConfig = await readProjectFile("next_app/next.config.ts");
  const instrumentation = await readProjectFile("next_app/instrumentation.ts");
  const clientConfig = await readProjectFile("next_app/instrumentation-client.ts");
  const serverConfig = await readProjectFile("next_app/sentry.server.config.ts");
  const edgeConfig = await readProjectFile("next_app/sentry.edge.config.ts");
  const globalError = await readProjectFile("next_app/app/global-error.tsx");

  assert.match(packageJson.dependencies["@sentry/nextjs"], /^\^10\.71\.0$/);
  assert.match(nextConfig, /withSentryConfig\(nextConfig/);
  assert.match(instrumentation, /sentry\.server\.config/);
  assert.match(instrumentation, /sentry\.edge\.config/);
  assert.match(instrumentation, /captureRequestError/);
  assert.match(clientConfig, /captureRouterTransitionStart/);
  assert.match(serverConfig, /Sentry\.init/);
  assert.match(edgeConfig, /Sentry\.init/);
  assert.match(globalError, /Sentry\.captureException\(error\)/);
});

test("Sentry stays disabled without a DSN and does not collect request payloads or replay", async () => {
  const privacyConfig = await readProjectFile("next_app/lib/sentry/privacy.ts");
  const clientConfig = await readProjectFile("next_app/instrumentation-client.ts");
  const serverConfig = await readProjectFile("next_app/sentry.server.config.ts");
  const edgeConfig = await readProjectFile("next_app/sentry.edge.config.ts");

  for (const runtimeConfig of [clientConfig, serverConfig, edgeConfig]) {
    assert.match(runtimeConfig, /enabled:\s*Boolean\(dsn\)/);
    assert.match(runtimeConfig, /sendDefaultPii:\s*false/);
    assert.match(runtimeConfig, /dataCollection:\s*sentryDataCollection/);
    assert.doesNotMatch(runtimeConfig, /replayIntegration|replaysSessionSampleRate|replaysOnErrorSampleRate/);
  }

  assert.match(privacyConfig, /cookies:\s*false/);
  assert.match(privacyConfig, /request:\s*false/);
  assert.match(privacyConfig, /response:\s*false/);
  assert.match(privacyConfig, /httpBodies:\s*\[\]/);
  assert.match(privacyConfig, /urlQueryParams:\s*false/);
  assert.match(privacyConfig, /stackFrameVariables:\s*false/);
  assert.match(privacyConfig, /delete event\.user/);
  assert.match(privacyConfig, /delete event\.extra/);
  assert.match(privacyConfig, /return null/);
});

test("Sentry and CMS secrets are represented by names only", async () => {
  const envExample = await readProjectFile("next_app/.env.example");
  const gitignore = await readProjectFile("next_app/.gitignore");
  const petsSync = await readProjectFile("next_app/lib/actions/petsSync.ts");

  for (const name of [
    "SENTRY_DSN",
    "NEXT_PUBLIC_SENTRY_DSN",
    "SENTRY_AUTH_TOKEN",
    "SENTRY_ORG",
    "SENTRY_PROJECT",
    "CMS_USERNAME",
    "CMS_PASSWORD",
  ]) {
    assert.match(envExample, new RegExp(`^${name}=$`, "m"));
  }

  assert.match(gitignore, /^!\.env\.example$/m);
  assert.doesNotMatch(petsSync, /CMS_USERNAME\s*\|\|/);
  assert.doesNotMatch(petsSync, /CMS_PASSWORD\s*\|\|/);
  assert.match(petsSync, /CMS認証情報が設定されていません/);
});
