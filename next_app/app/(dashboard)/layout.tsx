import SideNav from '@/components/layout/SideNav'
import BottomNav from '@/components/layout/BottomNav'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col md:flex-row">
      {/* PC: サイドバー */}
      <SideNav />

      {/* メインコンテンツ - md:pl-64 は PC時のサイドバー分の余白 */}
      <div className="flex-1 md:pl-64 flex flex-col min-h-screen">
        
        {/* モバイルヘッダー */}
        <header className="md:hidden bg-white shadow-sm h-14 flex items-center px-4 shrink-0">
          <span className="font-bold text-gray-900 tracking-wider">KENNEL</span>
        </header>

        {/* ページコンテンツ (ボトムナビの分だけ padding-bottom) */}
        <main className="flex-1 overflow-auto pb-20 md:pb-6 p-4 md:p-6 w-full mx-auto max-w-7xl">
          {children}
        </main>

        {/* スマホ: ボトムナビ */}
        <BottomNav />
      </div>
    </div>
  )
}
