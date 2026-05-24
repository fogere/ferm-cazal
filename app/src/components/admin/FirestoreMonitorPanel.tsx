import { useEffect, useState, useMemo } from 'react'
import { Activity, BarChart3, RotateCcw, ChevronDown, ChevronRight } from 'lucide-react'
import {
  getFirestoreStats,
  subscribeToStats,
  resetFirestoreStats,
  type CallRecord,
} from '../../services/firestoreMonitor'

/**
 * Panel "Monitoring Firebase" — BUGV3 #4.
 *
 * Affiche les statistiques d'utilisation Firestore mesurées CÔTÉ CLIENT :
 * - compteurs globaux (lectures, écritures, deletes, listeners actifs)
 * - debit (par session, par minute)
 * - quota Spark (jauges 50k reads / 20k writes / 20k deletes par jour)
 * - répartition par collection (table triée)
 * - journal des derniers appels (timeline)
 *
 * Sert à repérer :
 * - les listeners qui se ré-attachent en boucle (fan-out bug)
 * - les pages qui surconsomment quand on les ouvre
 * - les écritures redondantes (bumpOpti raté, retries, etc.)
 *
 * Pas de stockage : les compteurs vivent en mémoire JS de la session.
 * Reset = repartir de zéro pour mesurer une action précise.
 */

// Quotas Spark (gratuit) par jour, totaux sur l'ensemble du projet Firebase.
// Note : ce panel montre la consommation d'UN client, pas le total cross-clients.
const QUOTA_READS_PER_DAY  = 50_000
const QUOTA_WRITES_PER_DAY = 20_000
const QUOTA_DELETES_PER_DAY = 20_000

function fmtNumber(n: number): string {
  if (n < 1000) return String(n)
  if (n < 10_000) return (n / 1000).toFixed(2) + 'k'
  return Math.round(n / 1000) + 'k'
}

function fmtDuration(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

function fmtAgo(ts: number, now: number): string {
  const d = now - ts
  if (d < 1000) return 'à l\'instant'
  if (d < 60_000) return `${Math.floor(d / 1000)}s`
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}min`
  return `${Math.floor(d / 3_600_000)}h`
}

const KIND_COLOR: Record<CallRecord['kind'], string> = {
  'read':               'bg-sky/15 text-sky',
  'read-cache':         'bg-meadow/15 text-meadow',
  'write':              'bg-sun/15 text-earth',
  'delete':             'bg-danger/15 text-danger',
  'listener-attach':    'bg-forest/15 text-forest',
  'listener-snapshot':  'bg-forest/8 text-forest/80',
  'listener-detach':    'bg-muted/10 text-muted',
  'batch-commit':       'bg-orange-100 text-orange-700',
}

const KIND_LABEL: Record<CallRecord['kind'], string> = {
  'read':               'GET',
  'read-cache':         'CACHE',
  'write':              'PUT',
  'delete':             'DEL',
  'listener-attach':    'SUB+',
  'listener-snapshot':  'SNAP',
  'listener-detach':    'SUB-',
  'batch-commit':       'BATCH',
}

export default function FirestoreMonitorPanel() {
  // On déclenche un re-render à chaque notify du store (microtâche coalescente).
  const [, setTick] = useState(0)
  const [now, setNow] = useState(Date.now())
  const [showRecent, setShowRecent] = useState(false)
  const [showByCol, setShowByCol] = useState(true)

  // S'abonne au store stats du wrapper Firestore.
  useEffect(() => {
    return subscribeToStats(() => setTick(t => (t + 1) & 0xffff))
  }, [])

  // Rafraîchit "now" toutes les secondes pour les "il y a Xs" et le débit/minute.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const stats = getFirestoreStats()
  const sessionMs = now - stats.sessionStartedAt
  const sessionMin = Math.max(1 / 60, sessionMs / 60_000)
  const readsPerMin  = stats.totalReads  / sessionMin
  const writesPerMin = (stats.totalWrites + stats.totalDeletes) / sessionMin

  // Projection 24h (rough) si on extrapole le rythme actuel.
  const proj24hReads  = Math.round(readsPerMin  * 60 * 24)
  const proj24hWrites = Math.round(writesPerMin * 60 * 24)

  // Tri des collections par activité (somme reads + writes desc).
  const sortedCollections = useMemo(() => {
    return Object.entries(stats.perCollection)
      .map(([name, c]) => ({ name, ...c, activity: c.reads + c.cacheReads + c.writes + c.deletes + c.listenerEvents }))
      .filter(c => c.activity > 0 || c.activeListeners > 0)
      .sort((a, b) => b.activity - a.activity)
    // Re-calculé à chaque tick — le `now` change toutes les secondes mais
    // perCollection est muté en place donc on suit bien la dernière version.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stats, now])

  return (
    <div className="bg-card rounded-2xl p-4 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Activity size={16} className="text-forest" />
          <p className="text-xs font-semibold text-muted uppercase tracking-wider">
            Monitoring Firebase
          </p>
        </div>
        <button
          onClick={resetFirestoreStats}
          className="text-[11px] text-muted active:text-charcoal flex items-center gap-1 px-2 py-1 rounded-lg border border-border/60 active:bg-cream"
          title="Remet les compteurs à zéro (utile pour mesurer une action précise)"
        >
          <RotateCcw size={11} /> Reset
        </button>
      </div>

      <p className="text-[11px] text-muted leading-relaxed mb-3">
        Mesuré côté client (cette session de {fmtDuration(sessionMs)}).
        Plan Spark : {fmtNumber(QUOTA_READS_PER_DAY)} reads / {fmtNumber(QUOTA_WRITES_PER_DAY)} writes / {fmtNumber(QUOTA_DELETES_PER_DAY)} deletes par jour, partagés entre toutes les utilisatrices.
      </p>

      {/* ── Grille principale 2x2 ── */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        <StatTile
          label="Lectures"
          value={stats.totalReads}
          sub={`${stats.totalDocsFetched} doc${stats.totalDocsFetched > 1 ? 's' : ''} reçus`}
          accent="sky"
        />
        <StatTile
          label="Écritures"
          value={stats.totalWrites}
          sub={stats.totalBatchCommits > 0 ? `${stats.totalBatchCommits} batch(s)` : '0 batch'}
          accent="sun"
        />
        <StatTile
          label="Suppressions"
          value={stats.totalDeletes}
          sub=" "
          accent="danger"
        />
        <StatTile
          label="Listeners actifs"
          value={stats.totalActiveListeners}
          sub={`${stats.totalListenerEvents} snap reçus`}
          accent="forest"
        />
      </div>

      {/* ── Cache hit ratio (si pertinent) ── */}
      {(stats.totalReads + stats.totalCacheReads) > 0 && (
        <div className="bg-meadow/5 border border-meadow/20 rounded-xl px-3 py-2 mb-3">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-muted">Cache hit ratio (opti.ts)</span>
            <span className="font-bold text-meadow">
              {Math.round(100 * stats.totalCacheReads / (stats.totalReads + stats.totalCacheReads))}%
            </span>
          </div>
          <p className="text-[10px] text-muted mt-0.5">
            {stats.totalCacheReads} servis depuis le cache · {stats.totalReads} depuis le serveur
          </p>
        </div>
      )}

      {/* ── Débit (par minute) + projection 24h ── */}
      <div className="bg-cream rounded-xl p-3 mb-3 border border-border/40">
        <p className="text-[10px] font-semibold text-muted uppercase tracking-wider mb-2">
          Débit observé sur cette session
        </p>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <p className="text-muted">Lectures/min</p>
            <p className="font-bold text-charcoal">{readsPerMin.toFixed(1)}</p>
            <p className="text-[10px] text-muted mt-0.5">~ {fmtNumber(proj24hReads)}/24h projeté</p>
          </div>
          <div>
            <p className="text-muted">Écritures/min</p>
            <p className="font-bold text-charcoal">{writesPerMin.toFixed(1)}</p>
            <p className="text-[10px] text-muted mt-0.5">~ {fmtNumber(proj24hWrites)}/24h projeté</p>
          </div>
        </div>

        {/* Jauge quota (basée sur la projection 24h, à titre indicatif) */}
        {(proj24hReads > QUOTA_READS_PER_DAY * 0.5 || proj24hWrites > QUOTA_WRITES_PER_DAY * 0.5) && (
          <div className="mt-2 pt-2 border-t border-border/40">
            <p className="text-[10px] text-danger font-semibold">
              ⚠ Au rythme actuel, on dépasserait le quota Spark sur 24h pour {proj24hReads > QUOTA_READS_PER_DAY ? 'les lectures' : proj24hWrites > QUOTA_WRITES_PER_DAY ? 'les écritures' : 'l\'une des deux ressources'}.
            </p>
          </div>
        )}
      </div>

      {/* ── Répartition par collection ── */}
      {sortedCollections.length > 0 && (
        <div className="mb-3">
          <button
            onClick={() => setShowByCol(v => !v)}
            className="flex items-center justify-between w-full mb-2 text-[11px] font-semibold text-muted uppercase tracking-wider active:text-charcoal"
          >
            <span className="flex items-center gap-1.5">
              <BarChart3 size={11} /> Par collection ({sortedCollections.length})
            </span>
            {showByCol ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
          {showByCol && (
            <div className="overflow-x-auto -mx-1">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="text-muted border-b border-border/40">
                    <th className="text-left font-semibold py-1 px-1">Collection</th>
                    <th className="text-right font-semibold py-1 px-1">GET</th>
                    <th className="text-right font-semibold py-1 px-1">PUT</th>
                    <th className="text-right font-semibold py-1 px-1">DEL</th>
                    <th className="text-right font-semibold py-1 px-1">SUB</th>
                    <th className="text-right font-semibold py-1 px-1">SNAP</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedCollections.map(c => (
                    <tr key={c.name} className="border-b border-border/20 last:border-0">
                      <td className="py-1 px-1 font-mono text-charcoal truncate max-w-[100px]" title={c.name}>{c.name}</td>
                      <td className="py-1 px-1 text-right tabular-nums">
                        {c.reads || '·'}
                        {c.cacheReads > 0 && <span className="text-meadow"> +{c.cacheReads}</span>}
                      </td>
                      <td className="py-1 px-1 text-right tabular-nums">{c.writes || '·'}</td>
                      <td className="py-1 px-1 text-right tabular-nums">{c.deletes || '·'}</td>
                      <td className={`py-1 px-1 text-right tabular-nums ${c.activeListeners > 0 ? 'font-bold text-forest' : ''}`}>
                        {c.activeListeners || '·'}
                      </td>
                      <td className="py-1 px-1 text-right tabular-nums text-muted">{c.listenerEvents || '·'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-[10px] text-muted mt-1.5 px-1">
                GET = lectures (cache en vert) · PUT = écritures · SUB = listeners actifs · SNAP = events reçus
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── Journal des appels récents ── */}
      <button
        onClick={() => setShowRecent(v => !v)}
        className="flex items-center justify-between w-full mb-2 text-[11px] font-semibold text-muted uppercase tracking-wider active:text-charcoal"
      >
        <span>Derniers appels ({stats.recent.length})</span>
        {showRecent ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      </button>
      {showRecent && (
        <div className="bg-cream rounded-xl border border-border/40 max-h-72 overflow-y-auto">
          {stats.recent.length === 0 ? (
            <p className="text-[11px] text-muted text-center italic py-4">
              Aucun appel encore — interagis avec l'app pour voir.
            </p>
          ) : (
            <ul className="divide-y divide-border/30">
              {stats.recent.slice(0, 80).map((r, i) => (
                <li key={`${r.ts}-${i}`} className="flex items-center gap-2 px-2 py-1.5 text-[10.5px]">
                  <span className={`px-1.5 py-0.5 rounded font-mono font-bold text-[9px] ${KIND_COLOR[r.kind]}`}>
                    {KIND_LABEL[r.kind]}
                  </span>
                  <span className="font-mono text-charcoal flex-1 truncate" title={r.path}>{r.path}</span>
                  {r.docs !== undefined && r.docs !== 1 && (
                    <span className="text-muted tabular-nums">×{r.docs}</span>
                  )}
                  {r.cached && (
                    <span className="text-meadow text-[9px] font-bold">CACHE</span>
                  )}
                  {r.durationMs !== undefined && (
                    <span className="text-muted tabular-nums">{Math.round(r.durationMs)}ms</span>
                  )}
                  <span className="text-muted/70 tabular-nums w-10 text-right">{fmtAgo(r.ts, now)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

function StatTile({ label, value, sub, accent }: {
  label: string
  value: number
  sub: string
  accent: 'sky' | 'sun' | 'danger' | 'forest'
}) {
  const colorMap: Record<typeof accent, string> = {
    sky:    'text-sky',
    sun:    'text-earth',
    danger: 'text-danger',
    forest: 'text-forest',
  }
  return (
    <div className="bg-cream rounded-xl px-3 py-2.5 border border-border/40">
      <p className="text-[10px] font-semibold text-muted uppercase tracking-wider">{label}</p>
      <p className={`text-xl font-bold tabular-nums leading-tight ${colorMap[accent]}`}>
        {fmtNumber(value)}
      </p>
      <p className="text-[10px] text-muted truncate">{sub}</p>
    </div>
  )
}
