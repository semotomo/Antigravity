import type { Breadcrumb, BrowserOptions, ErrorEvent } from "@sentry/nextjs";

type SentryDataCollection = NonNullable<BrowserOptions["dataCollection"]>;

/**
 * Sentry SDK v10では一部の収集項目が既定で有効になるため、
 * 棚卸し数量や認証情報が監視イベントへ混ざらないよう明示的に全て無効化する。
 */
export const sentryDataCollection: SentryDataCollection = {
  userInfo: false,
  cookies: false,
  httpHeaders: {
    request: false,
    response: false,
  },
  httpBodies: [],
  urlQueryParams: false,
  graphQL: {
    document: false,
    variables: false,
  },
  genAI: {
    inputs: false,
    outputs: false,
  },
  databaseQueryData: false,
  stackFrameVariables: false,
  frameContextLines: 3,
};

const stripQueryAndFragment = (url: string) => url.split(/[?#]/, 1)[0];

/** SDKや将来の手動追加から機微情報が入っても、送信直前に再度取り除く。 */
export function scrubSentryEvent(event: ErrorEvent): ErrorEvent {
  delete event.user;
  delete event.extra;

  if (event.request) {
    const safeUrl = event.request.url
      ? stripQueryAndFragment(event.request.url)
      : undefined;

    event.request = {
      method: event.request.method,
      url: safeUrl,
    };
  }

  return event;
}

/** 操作履歴には商品名・JAN・数量が混ざり得るため、パンくずは保存しない。 */
export function dropSentryBreadcrumb(_breadcrumb: Breadcrumb): null {
  return null;
}

export function parseSentrySampleRate(
  configuredValue: string | undefined,
  environment: string | undefined,
): number {
  if (!configuredValue) {
    return environment === "production" ? 0.05 : 0;
  }

  const parsed = Number(configuredValue);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : 0;
}
