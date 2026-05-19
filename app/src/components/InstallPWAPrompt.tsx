import { useEffect, useState } from 'react'
import { Download, X } from 'lucide-react'

/**
 * Bannière d'invitation à installer la PWA (téléphone et desktop).
 *
 * Chrome / Edge / Android Chrome / Samsung Internet émettent l'event
 * `beforeinstallprompt` quand l'app est installable. On le capture,
 * on bloque le mini-prompt natif, et on affiche notre propre banner
 * en bas qui appelle `prompt()` à la demande.
 *
 * Si l'utilisateur ferme la bannière, on note le timestamp et on attend
 * 7 jours avant de la re-afficher.
 *
 * iOS Safari n'émet pas cet event — on affiche alors une mini-instruction
 * "Partager → Sur l'écran d'accueil" si la plateforme est iOS et que l'app
 * n'est pas déjà installée.
 */

const SKIP_KEY = 'fm_pwa_install_skip'
const SKIP_DAYS = 7

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !('MSStream' in window)
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  // Mode app installée (Chrome Android, desktop)
  if (window.matchMedia('(display-mode: standalone)').matches) return true
  // Mode app installée sur iOS (Safari spec ancienne)
  const navStandalone = (navigator as Navigator & { standalone?: boolean }).standalone
  return navStandalone === true
}

function shouldSkipFromStorage(): boolean {
  try {
    const skipUntil = parseInt(localStorage.getItem(SKIP_KEY) ?? '0', 10)
    return skipUntil > Date.now()
  } catch { return false }
}

function markSkipped() {
  try {
    localStorage.setItem(SKIP_KEY, String(Date.now() + SKIP_DAYS * 24 * 3600_000))
  } catch { /* ignoré */ }
}

export default function InstallPWAPrompt() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null)
  const [showIosHint, setShowIosHint] = useState(false)

  useEffect(() => {
    if (isStandalone())          return // déjà installée
    if (shouldSkipFromStorage()) return // récemment refusée

    // Branche Chromium / Android : on attend l'event
    function onBefore(ev: Event) {
      ev.preventDefault()
      setInstallEvent(ev as BeforeInstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', onBefore)

    // Branche iOS : pas d'event → on affiche un mini hint après 2s
    if (isIOS()) {
      const t = setTimeout(() => setShowIosHint(true), 2000)
      return () => {
        clearTimeout(t)
        window.removeEventListener('beforeinstallprompt', onBefore)
      }
    }

    // Quand l'app vient d'être installée, on cache la bannière
    function onInstalled() { setInstallEvent(null); setShowIosHint(false) }
    window.addEventListener('appinstalled', onInstalled)

    return () => {
      window.removeEventListener('beforeinstallprompt', onBefore)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  async function handleInstall() {
    if (!installEvent) return
    try {
      await installEvent.prompt()
      const { outcome } = await installEvent.userChoice
      if (outcome === 'dismissed') markSkipped()
    } catch { /* ignoré */ }
    setInstallEvent(null)
  }

  function dismiss() {
    markSkipped()
    setInstallEvent(null)
    setShowIosHint(false)
  }

  // Pas d'event Chrome ET pas iOS → rien à afficher
  if (!installEvent && !showIosHint) return null

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-[9996] p-3 pointer-events-none"
      style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 76px)' }}
    >
      <div className="mx-auto max-w-md bg-forest text-white rounded-2xl shadow-2xl
                      flex items-center gap-3 px-4 py-3 pointer-events-auto toast-enter">
        <div className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center flex-shrink-0">
          <Download size={18} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold m-0">Installer l'application</p>
          {installEvent ? (
            <p className="text-xs text-white/70 mt-0.5 leading-tight">
              Accès rapide depuis l'écran d'accueil, comme une vraie app
            </p>
          ) : (
            <p className="text-xs text-white/70 mt-0.5 leading-tight">
              Appuie sur <b>Partager</b> ⏏ puis <b>« Sur l'écran d'accueil »</b>
            </p>
          )}
        </div>
        {installEvent && (
          <button
            onClick={handleInstall}
            className="bg-white text-forest text-xs font-bold px-3 py-2 rounded-xl
                       active:scale-95 transition-transform flex-shrink-0"
          >
            Installer
          </button>
        )}
        <button
          onClick={dismiss}
          aria-label="Fermer"
          className="w-8 h-8 rounded-lg flex items-center justify-center text-white/60
                     active:bg-white/10 transition-colors flex-shrink-0"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  )
}
