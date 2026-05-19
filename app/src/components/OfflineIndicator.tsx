import { useEffect, useState } from 'react'
import { WifiOff } from 'lucide-react'

/**
 * Bandeau discret en haut de l'écran quand le navigateur signale qu'on est
 * hors ligne. Disparaît dès que la connexion revient.
 *
 * Note : `navigator.onLine` détecte la couche réseau, pas la disponibilité réelle
 * du serveur Firebase. C'est suffisant pour le cas mode-avion.
 */
export default function OfflineIndicator() {
  const [online, setOnline] = useState(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  )

  useEffect(() => {
    function up()   { setOnline(true) }
    function down() { setOnline(false) }
    window.addEventListener('online',  up)
    window.addEventListener('offline', down)
    return () => {
      window.removeEventListener('online',  up)
      window.removeEventListener('offline', down)
    }
  }, [])

  if (online) return null

  return (
    <div
      className="fixed top-0 left-0 right-0 z-[9997] bg-sun text-earth
                 text-xs font-bold py-1.5 px-3 flex items-center justify-center gap-2
                 shadow-md"
      role="status"
      aria-live="polite"
    >
      <WifiOff size={14} />
      <span>Hors ligne — les données affichées proviennent du cache</span>
    </div>
  )
}
