import { NextResponse } from 'next/server';
import { syncPetsData } from '@/lib/actions/petsSync';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const authHeader = request.headers.get('Authorization');
  const cronSecret = process.env.CRON_SECRET;

  // セキュリティ検証: CRON_SECRET環境変数が設定されていない場合、またはBearerトークンが一致しない場合は弾く
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    console.warn('[Cron API] Unauthorized access attempt.');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    console.log('[Cron API] 1日1回の定期差分同期を開始します...');
    const result = await syncPetsData('quick');
    console.log('[Cron API] 定期同期が正常終了しました:', result);
    
    return NextResponse.json({ 
      success: true, 
      message: '定期同期が正常に完了しました',
      result 
    });
  } catch (error: any) {
    console.error('[Cron API] 定期同期中に例外が発生しました:', error);
    return NextResponse.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
}
