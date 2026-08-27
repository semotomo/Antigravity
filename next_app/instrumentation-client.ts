import * as Sentry from "@sentry/nextjs";
import {
  dropSentryBreadcrumb,
  parseSentrySampleRate,
  scrubSentryEvent,
  sentryDataCollection,
} from "./lib/sentry/privacy";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
const environment =
  process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? process.env.NODE_ENV;

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  environment,
  sendDefaultPii: false,
  dataCollection: sentryDataCollection,
  tracesSampleRate: parseSentrySampleRate(
    process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE,
    environment,
  ),
  beforeSend: scrubSentryEvent,
  beforeBreadcrumb: dropSentryBreadcrumb,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
