import { useEffect, useState } from 'react'
import { WifiOff } from 'lucide-react'

/**
 * Pastille discrète en haut à gauche signalant le mode hors ligne.
 *
 * - Invisible quand le réseau est OK (zéro encombrement visuel).
 * - Hors ligne : petit badge orange clignotant doux. Au tap, déplie une infobulle
 *   expliquant que l'app reste 100% utilisable et que les modifs seront synchronisées
 *   automatiquement au retour réseau.
 *
 * Note : `navigator.onLine` détecte la couche réseau, pas la disponibilité réelle
 * du serveur Firebase. Suffisant pour le cas mode-avion / coupure mobile.
 */
export default function OfflineIndicator() {
  const [online, setOnline] = useState(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  )
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    function up()   { setOnline(true); setExpanded(false) }
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
    <>
      {/* Pastille flottante — toujours visible quand offline, peu intrusive.
          Position haut-gauche : le coin haut-droite de la carte est déjà occupé
          par les contrôles de couches/recentrage. La pastille occupe la safe-area
          (zone notch) où rien d'utile n'est rendu. */}
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        aria-label="Mode hors ligne — appuyer pour les détails"
        className="fixed top-3 left-3 z-[9997] w-7 h-7 rounded-full
                   bg-sun/95 border border-earth/30 shadow-md
                   flex items-center justify-center
                   active:scale-95 transition-transform
                   offline-pulse"
        style={{ pointerEvents: 'auto' }}
      >
        <WifiOff size={12} className="text-earth" />
      </button>

      {/* Animation de pulsation très douce — signale sans agresser */}
      <style>{`
        @keyframes offline-pulse-kf {
          0%, 100% { box-shadow: 0 0 0 0 rgba(234, 88, 12, 0.45); }
          50%      { box-shadow: 0 0 0 6px rgba(234, 88, 12, 0); }
        }
        .offline-pulse {
          animation: offline-pulse-kf 2.4s ease-in-out infinite;
        }
      `}</style>

      {/* Infobulle au tap — donne les détails à l'utilisateur */}
      {expanded && (
        <>
          <div
            className="fixed inset-0 z-[9996]"
            onClick={() => setExpanded(false)}
            aria-hidden
          />
          <div
            role="dialog"
            aria-live="polite"
            className="fixed top-12 left-3 z-[9998] w-[88vw] max-w-xs
                       bg-card border border-border rounded-2xl shadow-xl p-3.5
                       text-charcoal"
          >
            <div className="flex items-center gap-2 mb-2">
              <WifiOff size={14} className="text-earth" />
              <p className="text-sm font-bold">Hors ligne</p>
            </div>
            <p className="text-[12px] text-muted leading-relaxed">
              L'app fonctionne normalement depuis le cache. Tes modifications sont
              <strong> enregistrées localement</strong> et seront envoyées à la base
              centrale dès que la connexion revient.
            </p>
            <p className="text-[11px] text-muted/70 mt-2 leading-snug">
              Tu ne recevras pas les changements faits par les autres en temps réel
              tant que tu es hors ligne.
            </p>
          </div>
        </>
      )}
    </>
  )
}
