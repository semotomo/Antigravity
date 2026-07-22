import { revalidatePath } from 'next/cache';
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

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
    console.log(`[Cron Sales Import] 売上取込対象店舗数: ${targetStores.length}店舗`);

    if (targetStores.length === 0) {
      targetStores.push({ id: 0, name: 'デフォルト設定店舗', pos_group_id: '', pos_group_name: '' });
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

    const syncResults = [];
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    for (let i = 0; i < targetStores.length; i++) {
      const store = targetStores[i];

      // 2店舗目以降は指定時間（10秒）のウェイトを設ける
      if (i > 0) {
        console.log(`[Cron Sales Import] 次の店舗売上取込まで10秒間待機します (${i + 1}/${targetStores.length})...`);
        await sleep(10000);
      }

      console.log(`[Cron Sales Import] [${store.name}] の売上取込を開始します...`);

      // クエリパラメータの構築
      const url = new URL(gasWebAppUrl);
      url.searchParams.set('mode', 'sales');
      url.searchParams.set('year', String(year));
      url.searchParams.set('month', String(month));
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
        console.error(`[Cron Sales Import] [${store.name}] の取込に失敗しました:`, responseText);
        syncResults.push({ store: store.name, success: false, error: responseText });
        continue;
      }

      const gasResult = (await response.json().catch(() => null)) as {
        success?: boolean;
        message?: string;
      } | null;

      if (!gasResult || gasResult.success === false) {
        const errMsg = gasResult?.message || 'GAS内部でエラーが発生しました。';
        console.error(`[Cron Sales Import] [${store.name}] GAS応答エラー:`, errMsg);
        syncResults.push({ store: store.name, success: false, error: errMsg });
        continue;
      }

      console.log(`[Cron Sales Import] [${store.name}] 取込完了:`, gasResult.message);
      syncResults.push({ store: store.name, success: true, message: gasResult.message });
    }

    // キャッシュ再検証
    revalidatePath('/sales');
    revalidatePath('/sales/daily');
    revalidatePath('/sales/abc');

    // 同期履歴の更新
    await supabase.from('sync_history').upsert({
      sync_type: 'sales_import',
      last_synced_at: new Date().toISOString(),
    });

    console.log('[Cron Sales Import] すべての店舗の売上データ取込が正常終了しました。結果:', syncResults);
    return NextResponse.json({
      success: true,
      message: `売上データ自動取込 (${year}年${month}月分) が完了しました。`,
      results: syncResults
    });
  } catch (error: any) {
    console.error('[Cron Sales Import] 売上データ自動取込中に例外が発生しました:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
