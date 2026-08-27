import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: any = {
  allowedDevOrigins: ['192.168.1.89'],
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
};

const canUploadSentrySourceMaps = Boolean(
  process.env.SENTRY_AUTH_TOKEN &&
    process.env.SENTRY_ORG &&
    process.env.SENTRY_PROJECT,
);

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  telemetry: false,
  silent: true,
  sourcemaps: {
    disable: !canUploadSentrySourceMaps,
    deleteSourcemapsAfterUpload: true,
  },
  widenClientFileUpload: false,
  webpack: {
    treeshake: {
      removeDebugLogging: true,
      excludeReplayIframe: true,
      excludeReplayShadowDOM: true,
      excludeReplayCompressionWorker: true,
    },
  },
});
