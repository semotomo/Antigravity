'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Database } from '@/lib/types/database';
import { syncPetsData } from '@/lib/actions/petsSync';
import { Search, RefreshCw, Dog, Cat, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PetDetailModal } from './PetDetailModal';

type Pet = Database['public']['Tables']['cms_pets']['Row'];

export function PetsBoard() {
  const [pets, setPets] = useState<Pet[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedPet, setSelectedPet] = useState<Pet | null>(null);

  const supabase = createClient();

  useEffect(() => {
    fetchPets();
  }, []);

  const fetchPets = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('cms_pets')
      .select('*')
      .order('updated_at', { ascending: false });

    if (!error && data) {
      setPets(data);
    }
    setLoading(false);
  };

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

  const filteredPets = pets.filter(p => 
    (p.title?.includes(searchTerm) || '') || 
    (p.pet_number?.includes(searchTerm) || '') ||
    (p.breed?.includes(searchTerm) || '')
  );

  return (
    <div className="flex flex-col h-full bg-slate-50 p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-slate-800 flex items-center">
          <Dog className="w-6 h-6 mr-2 text-indigo-600" />
          生体情報（犬猫）
        </h1>
        <Button 
          onClick={handleSync} 
          disabled={syncing}
          className="bg-indigo-600 hover:bg-indigo-700 text-white"
        >
          <RefreshCw className={`w-4 h-4 mr-2 ${syncing ? 'animate-spin' : ''}`} />
          {syncing ? '同期中...' : '最新情報を同期'}
        </Button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex-1 flex flex-col">
        <div className="p-4 border-b border-slate-200 flex items-center gap-4 bg-slate-50/50">
          <div className="relative max-w-sm flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="生体番号、品種などで検索..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 text-sm border-slate-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500"
            />
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
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredPets.map(pet => (
                <div 
                  key={pet.id} 
                  className="bg-white border border-slate-200 rounded-xl overflow-hidden hover:shadow-md transition-shadow cursor-pointer flex"
                  onClick={() => setSelectedPet(pet)}
                >
                  <div className="w-32 bg-slate-100 flex items-center justify-center border-r border-slate-100 relative">
                    {pet.image_url ? (
                      <img src={pet.image_url} alt={pet.breed || ''} className="w-full h-full object-cover" />
                    ) : (
                      <div className="text-slate-400 flex flex-col items-center">
                        {pet.species === 'dog' ? <Dog className="w-8 h-8 opacity-50" /> : <Cat className="w-8 h-8 opacity-50" />}
                        <span className="text-xs mt-1">No Image</span>
                      </div>
                    )}
                  </div>
                  <div className="p-4 flex-1">
                    <div className="flex items-start justify-between mb-1">
                      <span className="text-xs font-semibold px-2 py-1 rounded-full bg-indigo-50 text-indigo-700">
                        {pet.pet_number || '番号なし'}
                      </span>
                      <span className={`text-xs font-semibold px-2 py-1 rounded-full ${pet.species === 'dog' ? 'bg-orange-50 text-orange-700' : 'bg-emerald-50 text-emerald-700'}`}>
                        {pet.species === 'dog' ? '犬' : '猫'}
                      </span>
                    </div>
                    <h3 className="font-bold text-slate-800 line-clamp-2 leading-tight mb-2">
                      {pet.breed || pet.title}
                    </h3>
                    <div className="text-xs text-slate-500 space-y-1">
                      <p>毛色: {pet.color || '-'}</p>
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
