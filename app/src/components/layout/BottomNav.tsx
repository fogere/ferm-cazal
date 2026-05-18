import { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { Home, CheckSquare, Map, Bell, Settings } from 'lucide-react'
import { collection, query, where, onSnapshot } from 'firebase/firestore'
import { db } from '../../firebase'

const NAV_ITEMS = [
  { to: '/dashboard', icon: Home,        label: 'Accueil',  badge: false },
  { to: '/tasks',     icon: CheckSquare, label: 'Tâches',   badge: false },
  { to: '/map',       icon: Map,         label: 'Carte',    badge: false },
  { to: '/alerts',    icon: Bell,        label: 'Alertes',  badge: true  },
  { to: '/settings',  icon: Settings,    label: 'Réglages', badge: false },
] as const

export default function BottomNav() {
  const [activeAlerts, setActiveAlerts] = useState(0)

  useEffect(() => {
    const q = query(collection(db, 'alerts'), where('resolved', '==', false))
    const unsub = onSnapshot(q, snap => setActiveAlerts(snap.size))
    return unsub
  }, [])

  return (
    <nav className="flex-shrink-0 bg-card border-t border-border safe-bottom"
         style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
      <div className="flex">
        {NAV_ITEMS.map(({ to, icon: Icon, label, badge }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center justify-center py-2.5 gap-0.5 transition-colors duration-150 ` +
              (isActive ? 'text-forest' : 'text-muted')
            }
          >
            {({ isActive }) => (
              <>
                <span className="relative">
                  <Icon size={22} strokeWidth={isActive ? 2.5 : 1.75} />
                  {badge && activeAlerts > 0 && (
                    <span className="absolute -top-1.5 -right-2 min-w-[18px] h-[18px] px-1 rounded-full
                                     bg-danger text-white text-[10px] font-bold flex items-center justify-center
                                     ring-2 ring-card">
                      {activeAlerts > 9 ? '9+' : activeAlerts}
                    </span>
                  )}
                </span>
                <span className={`text-xs font-medium ${isActive ? 'text-forest' : 'text-muted'}`}>
                  {label}
                </span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
