import { revalidatePath } from 'next/cache';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const authHeader = request.headers.get('Authorization');
  const cronSecret = process.env.CRON_SECRET;

  // セキュリティチェック
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    console.warn('[Cron Products Sync] Unauthorized access attempt.');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    console.log('[Cron Products Sync] 商品マスタの自動同期を開始します...');
    const gasWebAppUrl = process.env.GAS_WEBAPP_URL;

    if (!gasWebAppUrl) {
      throw new Error('GAS_WEBAPP_URL が設定されていません。');
    }

    // mode=master を付与して商品マスタ同期のみ実行
    const url = new URL(gasWebAppUrl);
    url.searchParams.set('mode', 'master');

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
      master?: { success?: boolean; message?: string; csvRowCount?: number; syncResult?: { count?: number } };
      message?: string;
    } | null;

    if (!gasResult) {
      throw new Error('GAS Web App が予期しない応答（HTML等）を返しました。');
    }

    if (gasResult.success === false) {
      throw new Error(gasResult.message || 'GAS処理中に全体エラーが発生しました。');
    }

    const masterResult = gasResult.master;
    if (masterResult && masterResult.success === false) {
      throw new Error(masterResult.message || '商品マスタの取得または同期に失敗しました。');
    }

    // 各売上関連ページのキャッシュを再検証
    revalidatePath('/sales');
    revalidatePath('/sales/daily');
    revalidatePath('/sales/products');
    revalidatePath('/sales/abc');
    revalidatePath('/products');

    const syncCount = masterResult?.syncResult?.count ?? 0;
    const csvCount = masterResult?.csvRowCount ?? 0;

    console.log('[Cron Products Sync] 商品マスタ自動同期が正常終了しました:', gasResult);
    return NextResponse.json({
      success: true,
      message: `商品マスタの自動同期が完了しました。（CSV: ${csvCount}件 → Supabase: ${syncCount}件処理）`,
      details: { csvCount, syncCount }
    });
  } catch (error: any) {
    console.error('[Cron Products Sync] 商品マスタ自動同期中にエラーが発生しました:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
