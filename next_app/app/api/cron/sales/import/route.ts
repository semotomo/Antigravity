import { revalidatePath } from 'next/cache';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const authHeader = request.headers.get('Authorization');
  const cronSecret = process.env.CRON_SECRET;

  // セキュリティチェック
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    console.warn('[Cron Sales Import] Unauthorized access attempt.');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    console.log('[Cron Sales Import] 売上データ自動取込を開始します...');

    const gasWebAppUrl = process.env.GAS_WEBAPP_URL;
    if (!gasWebAppUrl) {
      throw new Error('GAS_WEBAPP_URL が設定されていません。');
    }

    // 日本標準時 (JST) での「現在の年・月」を自動取得
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('ja-JP', {
      timeZone: 'Asia/Tokyo',
      year: 'numeric',
      month: 'numeric',
    });
    const parts = formatter.formatToParts(now);
    const year = Number(parts.find((p) => p.type === 'year')?.value);
    const month = Number(parts.find((p) => p.type === 'month')?.value);

    if (isNaN(year) || isNaN(month)) {
      throw new Error('現在年月の自動判定に失敗しました。');
    }

    console.log(`[Cron Sales Import] 対象年月: ${year}年${month}月`);

    // クエリパラメータの構築
    const url = new URL(gasWebAppUrl);
    url.searchParams.set('mode', 'sales');
    url.searchParams.set('year', String(year));
    url.searchParams.set('month', String(month));

    const response = await fetch(url.toString(), {
      method: 'GET',
      cache: 'no-store',
    });

    if (!response.ok) {
      const responseText = await response.text();
      throw new Error(responseText || 'GAS Web App の呼び出しに失敗しました。');
    }

    const gasResult = (await response.json().catch(() => null)) as {
      success?: boolean;
      message?: string;
    } | null;

    if (!gasResult) {
      throw new Error('GAS Web App が予期しない応答（HTML等）を返しました。');
    }

    if (gasResult.success === false) {
      throw new Error(gasResult.message || 'GAS処理中にエラーが発生しました。');
    }

    // キャッシュ再検証
    revalidatePath('/sales');
    revalidatePath('/sales/daily');
    revalidatePath('/sales/products');
    revalidatePath('/sales/abc');

    console.log('[Cron Sales Import] 売上データの自動取込が正常終了しました:', gasResult);
    return NextResponse.json({
      success: true,
      message: `売上データ自動取込 (${year}年${month}月分) が完了しました。`,
      target: { year, month }
    });
  } catch (error: any) {
    console.error('[Cron Sales Import] 売上データ自動取込中に例外が発生しました:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
