import { redirect } from 'next/navigation'

export default function Home() {
  // ルート("/") はダッシュボードのベースとなる売上一覧へリダイレクト
  redirect('/sales')
}
