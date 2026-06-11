import { Database } from '@/lib/types/database';
import { X, Dog, Cat, Info, MapPin, DollarSign, Activity } from 'lucide-react';

type Pet = Database['public']['Tables']['cms_pets']['Row'];

interface Props {
  pet: Pet;
  isOpen: boolean;
  onClose: () => void;
}

export function PetDetailModal({ pet, isOpen, onClose }: Props) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
      <div 
        className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />
      
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-xl ${pet.species === 'dog' ? 'bg-orange-100 text-orange-600' : 'bg-emerald-100 text-emerald-600'}`}>
              {pet.species === 'dog' ? <Dog className="w-5 h-5" /> : <Cat className="w-5 h-5" />}
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                {pet.breed || pet.title}
                <span className="text-sm font-normal px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
                  {pet.pet_number}
                </span>
              </h2>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 bg-slate-50">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            
            {/* Image Section */}
            <div className="space-y-4">
              <div className="aspect-square bg-slate-200 rounded-2xl overflow-hidden border border-slate-200 flex items-center justify-center shadow-inner relative">
                {pet.image_url ? (
                  <img src={pet.image_url} alt={pet.title} className="w-full h-full object-cover" />
                ) : (
                  <div className="text-slate-400 flex flex-col items-center">
                    {pet.species === 'dog' ? <Dog className="w-16 h-16 opacity-30" /> : <Cat className="w-16 h-16 opacity-30" />}
                    <span className="mt-2 font-medium">No Image Available</span>
                  </div>
                )}
                {pet.status !== '公開' && (
                  <div className="absolute top-4 right-4 bg-red-500 text-white text-xs font-bold px-3 py-1 rounded-full shadow-sm">
                    {pet.status}
                  </div>
                )}
              </div>
            </div>

            {/* Info Section */}
            <div className="space-y-6">
              
              <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                <h3 className="font-semibold text-slate-800 border-b border-slate-100 pb-2 flex items-center">
                  <Info className="w-4 h-4 mr-2 text-indigo-500" /> 基本情報
                </h3>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                  <div>
                    <dt className="text-slate-500 text-xs mb-1">毛色</dt>
                    <dd className="font-medium text-slate-800">{pet.color || '-'}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500 text-xs mb-1">性別</dt>
                    <dd className="font-medium text-slate-800">{pet.gender || '-'}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500 text-xs mb-1">生年月日</dt>
                    <dd className="font-medium text-slate-800">{pet.birth_date || '-'}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500 text-xs mb-1">出身地</dt>
                    <dd className="font-medium text-slate-800">{pet.origin || '-'}</dd>
                  </div>
                </dl>
              </div>

              <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                <h3 className="font-semibold text-slate-800 border-b border-slate-100 pb-2 flex items-center">
                  <Activity className="w-4 h-4 mr-2 text-rose-500" /> 健康・販売情報
                </h3>
                <dl className="grid grid-cols-1 gap-y-3 text-sm">
                  <div>
                    <dt className="text-slate-500 text-xs mb-1">生体価格</dt>
                    <dd className="font-bold text-lg text-rose-600">
                      {pet.price ? `${pet.price.toLocaleString()}円` : '-'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500 text-xs mb-1">ワクチン接種</dt>
                    <dd className="font-medium text-slate-800">{pet.vaccine_status || '-'}</dd>
                  </div>
                  {pet.pack_content && (
                    <div>
                      <dt className="text-slate-500 text-xs mb-1">パック内容</dt>
                      <dd className="font-medium text-slate-800 whitespace-pre-wrap">{pet.pack_content}</dd>
                    </div>
                  )}
                </dl>
              </div>

            </div>
          </div>
        </div>
        
        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-100 bg-white flex justify-end">
          <button 
            onClick={onClose} 
            className="px-4 py-2 border border-slate-300 rounded-md text-sm font-medium text-slate-700 bg-white hover:bg-slate-50 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
