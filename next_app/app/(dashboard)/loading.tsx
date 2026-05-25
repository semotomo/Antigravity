export default function DashboardLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* ヘッダースケルトン */}
      <div className="overflow-hidden rounded-[2rem] border border-gray-200 bg-white shadow-sm">
        <div className="bg-gradient-to-r from-gray-200 via-gray-300 to-gray-200 h-44 px-6 py-7 flex flex-col justify-between">
          <div className="h-4 w-24 bg-gray-400/30 rounded-full" />
          <div className="space-y-3">
            <div className="h-8 w-48 bg-gray-400/40 rounded-full" />
            <div className="h-4 w-96 bg-gray-400/30 rounded-full" />
          </div>
        </div>
        <div className="grid gap-4 px-6 py-5 md:grid-cols-3">
          <div className="h-28 rounded-2xl bg-gray-100" />
          <div className="h-28 rounded-2xl bg-gray-100" />
          <div className="h-28 rounded-2xl bg-gray-100" />
        </div>
      </div>

      {/* フィルタボタン群のスケルトン */}
      <div className="flex gap-2 overflow-x-auto pb-2">
        <div className="h-9 w-20 bg-gray-200 rounded-full shrink-0" />
        <div className="h-9 w-24 bg-gray-200 rounded-full shrink-0" />
        <div className="h-9 w-24 bg-gray-200 rounded-full shrink-0" />
        <div className="h-9 w-24 bg-gray-200 rounded-full shrink-0" />
      </div>

      {/* カードリストスケルトン */}
      <div className="grid gap-4 xl:grid-cols-2 2xl:grid-cols-3">
        {[...Array(3)].map((_, i) => (
          <div
            key={i}
            className="h-64 rounded-3xl border border-gray-200 bg-white p-5 shadow-sm space-y-4"
          >
            <div className="flex justify-between items-start">
              <div className="h-6 w-32 bg-gray-200 rounded-full" />
              <div className="h-6 w-16 bg-gray-200 rounded-full" />
            </div>
            <div className="h-24 bg-gray-50 rounded-2xl" />
            <div className="h-10 bg-gray-100 rounded-2xl" />
            <div className="flex gap-2">
              <div className="h-10 w-28 bg-gray-200 rounded-xl" />
              <div className="h-10 w-28 bg-gray-200 rounded-xl" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
