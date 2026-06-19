'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Database } from '@/lib/types/database';
import { syncPetsData } from '@/lib/actions/petsSync';
import { Search, RefreshCw, Dog, Cat, Info } from 'lucide-react';
import { PetDetailModal } from './PetDetailModal';

type Pet = Database['public']['Tables']['cms_pets']['Row'] & { stores: { name: string } | null };

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
  const [lastSyncTime, setLastSyncTime] = useState<string>('');

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
    const { data, error } = await supabase
      .from('cms_pets')
      .select('*, stores(name)')
      .eq('publish_status', '公開')
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
  }, []);

  const handleSync = async () => {
    setSyncing(true);
    const result = await syncPetsData();
    if (result.success) {
      alert(`同期成功: ${result.message}`);
      await fetchPets();
    } else {
      alert(`同期失敗: ${result.message}`);
    }
    setSyncing(false);
  };

  const filteredPets = pets.filter(p => {
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
          <button 
            onClick={handleSync} 
            disabled={syncing}
            className="flex items-center px-4 py-2 rounded-md font-medium text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? '同期中...' : '最新情報を同期'}
          </button>
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
                  className="bg-white border border-slate-200 rounded-xl overflow-hidden hover:shadow-md transition-shadow cursor-pointer p-3.5 flex flex-col justify-between"
                  onClick={() => setSelectedPet(pet)}
                >
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-bold px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-100">
                        {pet.management_no || '番号なし'}
                      </span>
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${pet.species === 'dog' || pet.species === '犬' ? 'bg-orange-50 text-orange-700' : 'bg-emerald-50 text-emerald-700'}`}>
                        {pet.species === 'dog' || pet.species === '犬' ? '犬' : '猫'}
                      </span>
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
