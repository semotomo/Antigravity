export default function OrderDetailLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* 戻るボタンのスケルトン */}
      <div className="h-9 w-32 bg-gray-200 rounded-full" />

      {/* 詳細ヘッダースケルトン */}
      <div className="overflow-hidden rounded-[2rem] border border-gray-200 bg-white shadow-sm">
        <div className="bg-gradient-to-r from-gray-200 via-gray-300 to-gray-200 h-44 px-6 py-7 flex flex-col justify-between">
          <div className="h-4 w-24 bg-gray-400/30 rounded-full" />
          <div className="space-y-3">
            <div className="h-8 w-64 bg-gray-400/40 rounded-full" />
            <div className="h-4 w-80 bg-gray-400/30 rounded-full" />
          </div>
        </div>
        <div className="grid gap-4 px-6 py-5 md:grid-cols-2 xl:grid-cols-5">
          <div className="h-20 rounded-2xl bg-gray-100" />
          <div className="h-20 rounded-2xl bg-gray-100" />
          <div className="h-20 rounded-2xl bg-gray-100" />
          <div className="h-20 rounded-2xl bg-gray-100" />
          <div className="h-20 rounded-2xl bg-gray-100" />
        </div>
      </div>

      {/* 詳細内容スケルトン */}
      <div className="h-96 rounded-[2rem] border border-gray-200 bg-white p-6 shadow-sm" />
    </div>
  )
}
