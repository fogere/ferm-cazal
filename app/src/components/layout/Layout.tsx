import { Outlet } from 'react-router-dom'
import BottomNav from './BottomNav'

export default function Layout() {
  return (
    <div className="flex flex-col h-full bg-cream overflow-hidden">
      {/* Zone de contenu scrollable */}
      <main className="flex-1 overflow-y-auto overscroll-contain">
        <Outlet />
      </main>

      {/* Navigation fixe en bas */}
      <BottomNav />
    </div>
  )
}
