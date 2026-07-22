'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Database } from '@/lib/types/database';
import { syncPetsData } from '@/lib/actions/petsSync';
import { Search, RefreshCw, Dog, Cat } from 'lucide-react';
import { PetDetailModal } from './PetDetailModal';

type Pet = Database['public']['Tables']['cms_pets']['Row'] & { stores: { name: string } | null };

export const getGenderClass = (gender: string | null) => {
  if (!gender) return '';
  if (gender.includes('女') || gender.includes('♀') || gender.includes('メス')) {
    return 'text-pink-600 font-bold bg-pink-50 px-1.5 py-0.5 rounded';
  }
  if (gender.includes('男') || gender.includes('♂') || gender.includes('オス')) {
    return 'text-sky-600 font-bold bg-sky-50 px-1.5 py-0.5 rounded';
  }
  return '';
};

export const renderPriceText = (text: string | null) => {
  if (!text) return <span className="text-slate-400">-</span>;
  const lines = text.split(/\r?\n/);
  const hasDiscount = text.includes('↓');
  
  if (!hasDiscount) {
    return (
      <div className="space-y-0.5 text-xs font-bold text-slate-700">
        {lines.map((line, idx) => {
          const hasNumber = /\d+/.test(line);
          return (
            <div key={idx} className={hasNumber ? 'text-rose-600' : ''}>
              {line}
            </div>
          );
        })}
      </div>
    );
  }
  
  let arrowFound = false;
  return (
    <div className="space-y-0.5 text-[10px] leading-tight">
      {lines.map((line, idx) => {
        if (line.includes('↓')) {
          arrowFound = true;
          return <div key={idx} className="text-slate-400 font-bold my-0.5">{line}</div>;
        }
        
        if (arrowFound) {
          const hasNumber = /\d+/.test(line);
          if (hasNumber) {
            return <div key={idx} className="text-rose-600 font-bold text-xs">{line}</div>;
          } else {
            return <div key={idx} className="text-amber-600 font-semibold">{line}</div>;
          }
        }
        
        const hasNumber = /\d+/.test(line);
        if (hasNumber) {
          return <div key={idx} className="text-slate-400">{line}</div>;
        }
        return <div key={idx} className="text-slate-400">{line}</div>;
      })}
    </div>
  );
};

const fallbackStores = [
  { id: 7, name: '本店' },
  { id: 1, name: '佐世保' },
  { id: 2, name: 'マックス' },
  { id: 3, name: '伊万里' },
  { id: 4, name: '武雄' },
  { id: 5, name: '周船寺' },
  { id: 6, name: 'わんわん' },
];

export function PetsBoard() {
  const [pets, setPets] = useState<Pet[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedPet, setSelectedPet] = useState<Pet | null>(null);
  const [stores, setStores] = useState<{ id: number; name: string }[]>([]);
  const [selectedStoreId, setSelectedStoreId] = useState<number | 'all'>(7); // デフォルト本店
  const [showSoldOut, setShowSoldOut] = useState<boolean>(false); // デフォルト販売終了は非表示
  const [lastSyncTime, setLastSyncTime] = useState<string>('');
  const [showDetailList, setShowDetailList] = useState<boolean>(false); // 詳細リスト表示のオン/オフ

  const supabase = createClient();

  const fetchStores = async () => {
    const { data, error } = await supabase
      .from('stores')
      .select('*')
      .order('id', { ascending: true });
    if (!error && data) {
      setStores(data);
    }
  };

  const fetchPets = async () => {
    setLoading(true);
    // 「公開」と「販売終了」の両方のデータをDBから取得
    const { data, error } = await supabase
      .from('cms_pets')
      .select('*, stores(name)')
      .in('publish_status', ['公開', '販売終了'])
      .order('updated_at', { ascending: false });

    if (!error && data) {
      setPets(data as any);
      if (data.length > 0) {
        const times = data
          .map((p: any) => p.updated_at ? new Date(p.updated_at).getTime() : 0)
          .filter(t => t > 0);
        if (times.length > 0) {
          const maxTime = Math.max(...times);
          setLastSyncTime(new Date(maxTime).toLocaleString('ja-JP', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
          }));
        }
      }
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchStores();
    fetchPets();

    const initializeDefaultStore = async () => {
      const cookiesObj = document.cookie.split('; ').reduce((acc, current) => {
        const parts = current.split('=')
        if (parts.length >= 2) {
          acc[parts[0]] = parts.slice(1).join('=')
        }
        return acc
      }, {} as Record<string, string>)

      let initialStore: number | 'all' = 7

      const storeView = cookiesObj.current_store_view
      if (storeView === 'wanwan') {
        initialStore = 6
      } else if (storeView === 'all') {
        initialStore = 'all'
      } else if (storeView === 'main') {
        initialStore = 7
      } else {
        const { data: { user } } = await supabase.auth.getUser()
        if (user?.user_metadata?.store_type === 'wanwan') {
          initialStore = 6
        }
      }
      setSelectedStoreId(initialStore)
    }

    initializeDefaultStore()
  }, []);

  const handleSync = async (mode: 'quick' | 'full') => {
    if (mode === 'full') {
      const confirmFull = window.confirm(
        "【注意】フル同期の実行確認\n\n" +
        "フル同期は全生体データを1件ずつ再スキャンするため、完了するまでに数分以上の時間がかかる場合があります。\n" +
        "サーバーへの負荷も高まるため、通常は「最新情報を同期」をご利用ください。\n\n" +
        "本当にフル同期を実行しますか？"
      );
      if (!confirmFull) {
        return;
      }
    }

    setSyncing(true);
    const result = await syncPetsData(mode);
    if (result.success) {
      alert(`同期成功: ${result.message}`);
      await fetchPets();
    } else {
      alert(`同期失敗: ${result.message}`);
    }
    setSyncing(false);
  };

  const filteredPets = pets.filter(p => {
    // 販売終了の子を含めるかどうかのチェック
    if (!showSoldOut && p.publish_status === '販売終了') {
      return false;
    }
    // 店舗での絞り込み
    if (selectedStoreId !== 'all' && p.store_id !== selectedStoreId) {
      return false;
    }
    // 検索語での絞り込み
    const matchesSearch = 
      (p.management_no?.includes(searchTerm) || false) ||
      (p.breed?.includes(searchTerm) || false);
    return matchesSearch;
  });

  return (
    <div className="flex flex-col h-full bg-slate-50 p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-slate-800 flex items-center">
          <Dog className="w-6 h-6 mr-2 text-indigo-600" />
          生体情報（犬猫）
        </h1>
        <div className="flex items-center gap-4">
          {lastSyncTime && (
            <span className="text-xs text-slate-500 font-medium">
              最終同期: {lastSyncTime}
            </span>
          )}
          <div className="flex gap-2">
            <button 
              onClick={() => handleSync('quick')} 
              disabled={syncing}
              className="flex items-center px-4 py-2 rounded-md font-medium text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${syncing ? 'animate-spin' : ''}`} />
              {syncing ? '同期中...' : '最新情報を同期'}
            </button>
            <button 
              onClick={() => handleSync('full')} 
              disabled={syncing}
              className="flex items-center px-4 py-2 rounded-md font-medium text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${syncing ? 'animate-spin' : ''}`} />
              {syncing ? '同期中...' : 'フル同期を実行'}
            </button>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex-1 flex flex-col">
        <div className="p-4 border-b border-slate-200 flex flex-wrap items-center gap-4 bg-slate-50/50">
          <div className="relative max-w-sm flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="生体番号、品種などで検索..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 text-sm border-slate-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-500">店舗:</span>
            <select
              value={selectedStoreId}
              onChange={(e) => setSelectedStoreId(e.target.value === 'all' ? 'all' : Number(e.target.value))}
              className="border border-slate-300 rounded-lg text-sm bg-white px-3 py-2 focus:ring-indigo-500 focus:border-indigo-500 font-medium text-slate-700 min-w-[150px]"
            >
              <option value="all">すべての店舗</option>
              {(stores.length > 0 ? stores : fallbackStores).map(store => (
                <option key={store.id} value={store.id}>{store.name}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="showSoldOut"
              checked={showSoldOut}
              onChange={(e) => setShowSoldOut(e.target.checked)}
              className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 h-4 w-4 cursor-pointer"
            />
            <label 
              htmlFor="showSoldOut" 
              className="text-xs font-semibold text-slate-700 cursor-pointer select-none"
            >
              販売終了の子を含める
            </label>
          </div>
          <div className="flex items-center gap-2 border-l border-slate-200 pl-4">
            <input
              type="checkbox"
              id="showDetailList"
              checked={showDetailList}
              onChange={(e) => setShowDetailList(e.target.checked)}
              className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 h-4 w-4 cursor-pointer"
            />
            <label 
              htmlFor="showDetailList" 
              className="text-xs font-semibold text-slate-700 cursor-pointer select-none"
            >
              詳細（写真・価格付き）表示
            </label>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-4">
          {loading ? (
            <div className="flex justify-center items-center h-full text-slate-400">
              <RefreshCw className="w-6 h-6 animate-spin mr-2" />
              読み込み中...
            </div>
          ) : filteredPets.length === 0 ? (
            <div className="text-center py-12 text-slate-500">
              見つかりませんでした。
            </div>
          ) : (
            showDetailList ? (
              <div className="flex flex-col gap-2.5">
                {[...filteredPets].sort((a, b) => {
                  const isADog = a.species === 'dog' || a.species === '犬';
                  const isBDog = b.species === 'dog' || b.species === '犬';
                  
                  if (isADog && !isBDog) return -1;
                  if (!isADog && isBDog) return 1;
                  
                  const noA = a.management_no || '';
                  const noB = b.management_no || '';
                  return noA.localeCompare(noB, 'ja-JP');
                }).map(pet => (
                  <div 
                    key={pet.id} 
                    className={`bg-white border border-slate-200 rounded-xl overflow-hidden hover:shadow-md transition-all cursor-pointer p-3 flex gap-4 items-center ${pet.publish_status === '販売終了' ? 'opacity-70 bg-slate-50/50' : ''}`}
                    onClick={() => setSelectedPet(pet)}
                  >
                    {/* 左側: 小さ目の写真 */}
                    <div className="w-16 h-16 bg-slate-100 rounded-lg overflow-hidden border border-slate-200 flex-shrink-0 flex items-center justify-center relative">
                      {pet.image_url ? (
                        <img src={pet.image_url} alt={pet.breed || ''} className="w-full h-full object-cover" />
                      ) : (
                        <div className="text-slate-400">
                          {pet.species === 'dog' || pet.species === '犬' ? <Dog className="w-6 h-6 opacity-30" /> : <Cat className="w-6 h-6 opacity-30" />}
                        </div>
                      )}
                    </div>
                    
                    {/* 右側: テキスト情報 */}
                    <div className="flex-1 min-w-0 grid grid-cols-1 md:grid-cols-4 gap-4 items-center">
                      <div>
                        <div className="flex items-center gap-1.5 mb-1">
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-100">
                            {pet.management_no || '番号なし'}
                          </span>
                          <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${pet.species === 'dog' || pet.species === '犬' ? 'bg-orange-50 text-orange-700' : 'bg-emerald-50 text-emerald-700'}`}>
                            {pet.species === 'dog' || pet.species === '犬' ? '犬' : '猫'}
                          </span>
                          {pet.publish_status === '販売終了' && (
                            <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-slate-200 text-slate-600 border border-slate-300">
                              販売終了
                            </span>
                          )}
                        </div>
                        <h3 className="font-bold text-slate-800 flex items-center gap-1.5">
                          {pet.breed || '品種不明'}
                        </h3>
                      </div>
                      
                      <div className="text-xs text-slate-500 space-y-0.5">
                        <p><span className="font-medium text-slate-400">毛色:</span> {pet.coat_color || '-'}</p>
                        <p>
                          <span className="font-medium text-slate-400">性別:</span>{' '}
                          <span className={getGenderClass(pet.gender)}>
                            {pet.gender || '-'}
                          </span>
                        </p>
                      </div>
                      
                      <div className="text-xs text-slate-500 space-y-0.5">
                        <p><span className="font-medium text-slate-400">誕生日:</span> {pet.birth_date || '-'}</p>
                        <p><span className="font-medium text-slate-400">店舗:</span> <span className="font-semibold text-indigo-600 bg-indigo-50/50 px-1 py-0.2 rounded">{pet.stores?.name || '未割り当て'}</span></p>
                        <p className="line-clamp-1"><span className="font-medium text-slate-400">ワクチン:</span> <span className="font-medium text-slate-700">{pet.vaccines || '-'}</span></p>
                      </div>
                      
                      <div className="text-xs">
                        <span className="text-slate-400 font-medium block mb-0.5">価格:</span>
                        {pet.price_text ? (
                          renderPriceText(pet.price_text)
                        ) : pet.price_tax_excluded ? (
                          <div className="font-bold text-rose-600 text-xs">
                            {pet.price_tax_excluded.toLocaleString()}円
                            {pet.price_tax_included && <span className="text-[9px] font-normal text-slate-500 block">(税込{pet.price_tax_included.toLocaleString()}円)</span>}
                          </div>
                        ) : (
                          <span className="text-slate-400">-</span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3.5">
                {[...filteredPets].sort((a, b) => {
                  const isADog = a.species === 'dog' || a.species === '犬';
                  const isBDog = b.species === 'dog' || b.species === '犬';
                  
                  if (isADog && !isBDog) return -1;
                  if (!isADog && isBDog) return 1;
                  
                  const noA = a.management_no || '';
                  const noB = b.management_no || '';
                  return noA.localeCompare(noB, 'ja-JP');
                }).map(pet => (
                  <div 
                    key={pet.id} 
                    className={`bg-white border border-slate-200 rounded-xl overflow-hidden hover:shadow-md transition-all cursor-pointer p-3.5 flex flex-col justify-between ${pet.publish_status === '販売終了' ? 'opacity-70 bg-slate-50/50' : ''}`}
                    onClick={() => setSelectedPet(pet)}
                  >
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-bold px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-100">
                          {pet.management_no || '番号なし'}
                        </span>
                        <div className="flex gap-1.5 items-center">
                          {pet.publish_status === '販売終了' && (
                            <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-slate-200 text-slate-600 border border-slate-300">
                              販売終了
                            </span>
                          )}
                          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${pet.species === 'dog' || pet.species === '犬' ? 'bg-orange-50 text-orange-700' : 'bg-emerald-50 text-emerald-700'}`}>
                            {pet.species === 'dog' || pet.species === '犬' ? '犬' : '猫'}
                          </span>
                        </div>
                      </div>
                      <h3 className="font-bold text-slate-800 line-clamp-1 leading-tight mb-2 flex items-center gap-1.5">
                        {pet.species === 'dog' || pet.species === '犬' ? <Dog className="w-4 h-4 text-orange-500 shrink-0" /> : <Cat className="w-4 h-4 text-emerald-500 shrink-0" />}
                        {pet.breed || '品種不明'}
                      </h3>
                      <div className="text-xs text-slate-500 space-y-1">
                        <p className="font-semibold text-indigo-600 bg-indigo-50/50 px-1.5 py-0.5 rounded inline-block">
                          {pet.stores?.name ? pet.stores.name : '未割り当て'}
                        </p>
                        <p>毛色: {pet.coat_color || '-'}</p>
                        <p>性別: {pet.gender || '-'}</p>
                        <p>誕生日: {pet.birth_date || '-'}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )
          )}
        </div>
      </div>

      {selectedPet && (
        <PetDetailModal 
          pet={selectedPet} 
          isOpen={!!selectedPet} 
          onClose={() => setSelectedPet(null)} 
        />
      )}
    </div>
  );
}
