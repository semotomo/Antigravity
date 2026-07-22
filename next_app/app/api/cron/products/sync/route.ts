import { revalidatePath } from 'next/cache';
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

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

    const supabase = await createClient() as any;

    // 1. 同期対象店舗（POSグループIDが設定されている店舗）を取得
    const { data: activeStores, error: storesError } = await supabase
      .from('stores')
      .select('id, name, pos_group_id, pos_group_name')
      .not('pos_group_id', 'is', null);

    if (storesError) {
      throw new Error(`店舗マッピング情報の取得に失敗しました: ${storesError.message}`);
    }

    const targetStores = activeStores || [];
    console.log(`[Cron Products Sync] 同期対象店舗数: ${targetStores.length}店舗`);

    if (targetStores.length === 0) {
      // 店舗設定がない場合は、デフォルトでGAS側の設定に任せる（フォールバック）
      targetStores.push({ id: 0, name: 'デフォルト設定店舗', pos_group_id: '', pos_group_name: '' });
    }

    const syncResults = [];
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    for (let i = 0; i < targetStores.length; i++) {
      const store = targetStores[i];

      // 2店舗目以降は指定時間（10秒）のウェイトを設ける
      if (i > 0) {
        console.log(`[Cron Products Sync] 次の店舗同期まで10秒間待機します (${i + 1}/${targetStores.length})...`);
        await sleep(10000);
      }

      console.log(`[Cron Products Sync] [${store.name}] の商品マスタ同期を呼び出します...`);

      const url = new URL(gasWebAppUrl);
      url.searchParams.set('mode', 'master');
      if (store.pos_group_id) {
        url.searchParams.set('tenpoGroupId', store.pos_group_id);
      }
      if (store.pos_group_name) {
        url.searchParams.set('tenpoGroupName', store.pos_group_name);
      }

      const response = await fetch(url.toString(), {
        method: 'GET',
        cache: 'no-store',
      });

      if (!response.ok) {
        const responseText = await response.text();
        console.error(`[Cron Products Sync] [${store.name}] の同期に失敗しました:`, responseText);
        syncResults.push({ store: store.name, success: false, error: responseText });
        continue;
      }

      const gasResult = (await response.json().catch(() => null)) as {
        success?: boolean;
        master?: { success?: boolean; message?: string; csvRowCount?: number; syncResult?: { count?: number } };
        message?: string;
      } | null;

      if (!gasResult || gasResult.success === false) {
        const errMsg = gasResult?.message || 'GAS内部でエラーが発生しました。';
        console.error(`[Cron Products Sync] [${store.name}] GAS応答エラー:`, errMsg);
        syncResults.push({ store: store.name, success: false, error: errMsg });
        continue;
      }

      const masterResult = gasResult.master;
      if (masterResult && masterResult.success === false) {
        const errMsg = masterResult.message || '商品マスタ同期処理に失敗しました。';
        console.error(`[Cron Products Sync] [${store.name}] マスタ同期エラー:`, errMsg);
        syncResults.push({ store: store.name, success: false, error: errMsg });
        continue;
      }

      const syncCount = masterResult?.syncResult?.count ?? 0;
      const csvCount = masterResult?.csvRowCount ?? 0;

      console.log(`[Cron Products Sync] [${store.name}] 同期完了: CSV: ${csvCount}件 -> Supabase: ${syncCount}件`);
      syncResults.push({ store: store.name, success: true, csvCount, syncCount });
    }

    // 各売上関連ページのキャッシュを再検証
    revalidatePath('/sales');
    revalidatePath('/sales/daily');
    revalidatePath('/sales/abc');
    revalidatePath('/products');

    // 同期履歴の更新
    await supabase.from('sync_history').upsert({
      sync_type: 'products_sync',
      last_synced_at: new Date().toISOString(),
    });

    console.log('[Cron Products Sync] すべての店舗の商品マスタ自動同期が終了しました。結果:', syncResults);
    return NextResponse.json({
      success: true,
      message: '商品マスタの自動同期が完了しました。',
      results: syncResults
    });
  } catch (error: any) {
    console.error('[Cron Products Sync] 商品マスタ自動同期中にエラーが発生しました:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
