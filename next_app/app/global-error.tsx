"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="ja">
      <body>
        <main
          style={{
            alignItems: "center",
            display: "flex",
            flexDirection: "column",
            gap: 16,
            justifyContent: "center",
            minHeight: "100vh",
            padding: 24,
            textAlign: "center",
          }}
        >
          <title>エラー | Kennel Dashboard</title>
          <h1>画面の読み込みに失敗しました</h1>
          <p>入力内容を確認してから、もう一度お試しください。</p>
          <button
            type="button"
            onClick={reset}
            style={{
              background: "#1d4ed8",
              border: 0,
              borderRadius: 8,
              color: "white",
              cursor: "pointer",
              fontSize: 16,
              padding: "12px 20px",
            }}
          >
            もう一度試す
          </button>
        </main>
      </body>
    </html>
  );
}
