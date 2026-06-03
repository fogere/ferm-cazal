import { useEffect, useRef, useState } from 'react'
import { Download, Check, X, Loader2 } from 'lucide-react'
import { precacheAerialTiles, countTiles, type PrecacheProgress } from '../services/map/precacheTiles'

// Centre de la ferme (le Cazal) — même point que la carte.
const FARM_CENTER: [number, number] = [42.9375, 1.7452]
const RADIUS_M = 1200      // ~2,4 km de côté autour de la ferme
const MIN_ZOOM = 15
const MAX_ZOOM = 19        // résolution native max d'IGN ; au-delà c'est de l'agrandissement
const DONE_LS_KEY = 'le-cazal:offlineMapDoneAt'

/**
 * Bouton "Télécharger la carte de la ferme (hors-ligne)". Pré-cache les tuiles
 * aériennes IGN de la zone ferme → ensuite la carte est instantanée et marche
 * sans réseau (cf. services/map/precacheTiles + cache du service worker).
 */
export default function OfflineMapButton() {
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<PrecacheProgress | null>(null)
  const [doneAt, setDoneAt] = useState<number | null>(() => {
    const v = localStorage.getItem(DONE_LS_KEY)
    return v ? Number(v) : null
  })
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => () => abortRef.current?.abort(), [])

  const total = countTiles({ center: FARM_CENTER, radiusMeters: RADIUS_M, minZoom: MIN_ZOOM, maxZoom: MAX_ZOOM })
  const estMb = Math.round((total * 20) / 1024) // ~20 Ko/tuile JPEG

  async function start() {
    if (running) return
    setRunning(true)
    setProgress({ done: 0, total, failed: 0 })
    const ctrl = new AbortController()
    abortRef.current = ctrl
    try {
      const res = await precacheAerialTiles({
        center: FARM_CENTER,
        radiusMeters: RADIUS_M,
        minZoom: MIN_ZOOM,
        maxZoom: MAX_ZOOM,
        onProgress: setProgress,
        signal: ctrl.signal,
      })
      if (!ctrl.signal.aborted) {
        const now = Date.now()
        localStorage.setItem(DONE_LS_KEY, String(now))
        setDoneAt(now)
        // Petit log discret si beaucoup d'échecs (réseau capricieux).
        if (res.failed > res.total * 0.1) {
          console.warn(`[offlineMap] ${res.failed}/${res.total} tuiles non téléchargées (réseau ?)`)
        }
      }
    } finally {
      setRunning(false)
      abortRef.current = null
    }
  }

  function cancel() {
    abortRef.current?.abort()
    setRunning(false)
  }

  const pct = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0

  return (
    <div className="space-y-2">
      {running ? (
        <>
          <div className="flex items-center gap-2 text-sm text-charcoal">
            <Loader2 size={16} className="animate-spin text-forest" />
            <span className="flex-1">Téléchargement… {pct}% ({progress?.done}/{progress?.total})</span>
            <button
              onClick={cancel}
              className="px-2 py-1 rounded-lg border border-border text-muted text-xs font-semibold active:bg-cream flex items-center gap-1"
            >
              <X size={12} /> Stop
            </button>
          </div>
          <div className="h-2 rounded-full bg-cream overflow-hidden">
            <div className="h-full bg-forest transition-all" style={{ width: `${pct}%` }} />
          </div>
        </>
      ) : (
        <button
          onClick={start}
          className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-forest text-white text-sm font-semibold active:opacity-80"
        >
          <Download size={16} />
          {doneAt ? 'Re-télécharger la carte de la ferme' : 'Télécharger la carte de la ferme'}
        </button>
      )}

      {doneAt && !running && (
        <p className="text-[11px] text-meadow font-semibold flex items-center gap-1">
          <Check size={12} /> Carte de la ferme disponible hors-ligne
          {` · ${new Date(doneAt).toLocaleDateString('fr-FR')}`}
        </p>
      )}
      {!doneAt && !running && (
        <p className="text-[11px] text-muted">
          ~{total} tuiles (~{estMb} Mo). Une fois fait, la carte de la ferme est instantanée, même sans réseau.
        </p>
      )}
    </div>
  )
}
