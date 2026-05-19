import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { registerSW } from 'virtual:pwa-register'

/**
 * Détecte automatiquement quand une nouvelle version de l'app est déployée
 * et propose à l'utilisateur de recharger pour l'appliquer.
 *
 * Problème adressé : avec PWA installée, le service worker peut garder un
 * cache de l'ancienne version. Sans ce prompt, l'utilisateur reste bloqué
 * sur la vieille build jusqu'à ce qu'il désinstalle/réinstalle.
 *
 * Le check de mise à jour tourne :
 *   - à chaque ouverture de l'app
 *   - toutes les 30 minutes en arrière-plan (timer périodique)
 *   - quand l'app revient au premier plan (visibilitychange)
 */
export default function UpdatePrompt() {
  const [needRefresh, setNeedRefresh] = useState(false)
  const [updateSW, setUpdateSW] = useState<((reload?: boolean) => Promise<void>) | null>(null)

  useEffect(() => {
    let registration: ServiceWorkerRegistration | undefined

    const update = registerSW({
      immediate: true,
      onNeedRefresh() {
        setNeedRefresh(true)
      },
      onRegisteredSW(_swUrl, reg) {
        registration = reg
        if (!reg) return
        // Check une nouvelle version toutes les 30 minutes
        setInterval(() => {
          reg.update().catch(() => {})
        }, 30 * 60 * 1000)
      },
    })
    setUpdateSW(() => update)

    // Quand l'utilisateur revient sur l'app (changement d'onglet, app
    // remise au premier plan), on déclenche un check immédiatement.
    function onVisibilityChange() {
      if (document.visibilityState === 'visible' && registration) {
        registration.update().catch(() => {})
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [])

  if (!needRefresh) return null

  async function applyUpdate() {
    if (!updateSW) return
    try {
      await updateSW(true)
      // updateSW(true) recharge la page automatiquement
    } catch {
      // Fallback : reload manuel
      window.location.reload()
    }
  }

  return (
    <div
      className="fixed top-0 left-0 right-0 z-[9999] p-3 pointer-events-none"
      style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 8px)' }}
    >
      <div className="mx-auto max-w-md bg-meadow text-charcoal rounded-2xl shadow-2xl
                      flex items-center gap-3 px-4 py-3 pointer-events-auto toast-enter">
        <div className="w-9 h-9 rounded-xl bg-white/30 flex items-center justify-center flex-shrink-0">
          <RefreshCw size={16} className="text-forest" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold m-0">Mise à jour disponible</p>
          <p className="text-xs text-charcoal/70 mt-0.5 leading-tight">
            Une nouvelle version de l'application a été déployée
          </p>
        </div>
        <button
          onClick={applyUpdate}
          className="bg-forest text-white text-xs font-bold px-4 py-2 rounded-xl
                     active:scale-95 transition-transform flex-shrink-0"
        >
          Recharger
        </button>
      </div>
    </div>
  )
}
