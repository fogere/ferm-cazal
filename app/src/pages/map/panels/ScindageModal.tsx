// Modal de scindage automatique d'un espace par une clôture (S7.3).
// Demande Eugénie 21/05/2026, suite à la refonte clôtures/espaces : quand on
// dessine une clôture qui traverse un land_plot existant, on propose
// automatiquement de découper l'espace en 2 sous-espaces. L'utilisatrice
// confirme et répartit les animaux entre les 2 nouveaux espaces.
//
// Reçoit :
//   - le land_plot d'origine (parent)
//   - le SplitResult (p1/p2/cut) calculé par splitPolygonByPolyline
//   - les animaux candidats (ceux qui étaient placés dans le parent)
//   - callbacks onCancel / onConfirm
//
// Cette modal est purement UI : c'est le caller qui décide quoi faire des
// données quand l'utilisateur confirme (création Firestore = S7.4 dans Map.tsx).

import { useMemo, useState } from 'react'
import type { Animal, MapPin } from '../../../types'
import type { SplitResult } from '../../../services/map/polygon-split'

export interface ScindageChoice {
  /** Nom donné au 1er sous-espace (défaut "{parent} - 1"). */
  name1:        string
  /** Nom donné au 2ème sous-espace (défaut "{parent} - 2"). */
  name2:        string
  /** Pour chaque animal du parent, la cible : 'p1' ou 'p2'. */
  animalChoice: Record<string, 'p1' | 'p2'>
}

interface Props {
  parent:    MapPin
  split:     SplitResult
  animals:   Animal[]
  saving:    boolean
  onCancel:  () => void
  onConfirm: (choice: ScindageChoice) => void | Promise<void>
}

export function ScindageModal({ parent, split, animals, saving, onCancel, onConfirm }: Props) {
  const [name1, setName1] = useState(`${parent.name} - 1`)
  const [name2, setName2] = useState(`${parent.name} - 2`)
  const [animalChoice, setAnimalChoice] = useState<Record<string, 'p1' | 'p2'>>(
    // Par défaut, tous les animaux vont en p1. L'utilisatrice réassigne au besoin.
    () => Object.fromEntries(animals.map(a => [a.id, 'p1' as const])),
  )

  const previewBox = useMemo(() => buildPreviewBox(split), [split])

  const setAll = (target: 'p1' | 'p2') =>
    setAnimalChoice(Object.fromEntries(animals.map(a => [a.id, target])))

  const canConfirm = !saving && name1.trim().length > 0 && name2.trim().length > 0

  return (
    <div className="absolute inset-0 z-[2100] flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={saving ? undefined : onCancel} />
      <div className="relative bg-card rounded-t-3xl px-5 pt-5 pb-10 shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between mb-3">
          <div>
            <h2 className="text-charcoal text-lg font-bold m-0">✂️ Découpage détecté</h2>
            <p className="text-xs text-muted mt-1">
              Ta clôture traverse <span className="font-semibold text-charcoal">{parent.name}</span> — on peut le scinder en 2 espaces indépendants.
            </p>
          </div>
        </div>

        {/* Aperçu visuel des 2 sous-polygons + coupe */}
        <div className="rounded-xl border border-border bg-cream p-3 mb-4">
          <p className="text-[10px] text-muted uppercase tracking-wider mb-2">Aperçu</p>
          <svg viewBox={previewBox.viewBox} className="w-full h-32" preserveAspectRatio="xMidYMid meet">
            <polygon points={previewBox.p1Pts} fill="#84cc16" fillOpacity={0.35} stroke="#65a30d" strokeWidth={0.5} />
            <polygon points={previewBox.p2Pts} fill="#0ea5e9" fillOpacity={0.35} stroke="#0284c7" strokeWidth={0.5} />
            <polyline points={previewBox.cutPts} fill="none" stroke="#EA580C" strokeWidth={1.2} strokeLinecap="round" />
          </svg>
          <div className="flex justify-around text-[11px] mt-2">
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-lime-500/35 border border-lime-700" /> {name1.trim() || 'Partie 1'}</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-sky-500/35 border border-sky-700" /> {name2.trim() || 'Partie 2'}</span>
          </div>
        </div>

        {/* Noms des 2 sous-espaces */}
        <div className="grid grid-cols-2 gap-2 mb-4">
          <label className="block">
            <span className="text-[10px] text-muted uppercase tracking-wider">Nom partie 1</span>
            <input
              type="text" value={name1} onChange={e => setName1(e.target.value)} disabled={saving}
              className="w-full mt-1 px-3 py-2 rounded-lg border border-lime-500/40 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-lime-500/30"
            />
          </label>
          <label className="block">
            <span className="text-[10px] text-muted uppercase tracking-wider">Nom partie 2</span>
            <input
              type="text" value={name2} onChange={e => setName2(e.target.value)} disabled={saving}
              className="w-full mt-1 px-3 py-2 rounded-lg border border-sky-500/40 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/30"
            />
          </label>
        </div>

        {/* Liste des animaux à répartir */}
        {animals.length > 0 ? (
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] text-muted uppercase tracking-wider">
                Animaux à répartir ({animals.length})
              </p>
              <div className="flex gap-1">
                <button
                  type="button" onClick={() => setAll('p1')} disabled={saving}
                  className="text-[10px] font-semibold px-2 py-0.5 rounded border border-lime-500/40 text-lime-700 bg-lime-500/10 active:bg-lime-500/20 disabled:opacity-40"
                >
                  Tous en 1
                </button>
                <button
                  type="button" onClick={() => setAll('p2')} disabled={saving}
                  className="text-[10px] font-semibold px-2 py-0.5 rounded border border-sky-500/40 text-sky-700 bg-sky-500/10 active:bg-sky-500/20 disabled:opacity-40"
                >
                  Tous en 2
                </button>
              </div>
            </div>
            <ul className="space-y-1 max-h-44 overflow-y-auto pr-1">
              {animals.map(a => {
                const target = animalChoice[a.id] ?? 'p1'
                return (
                  <li key={a.id} className="flex items-center justify-between gap-2 px-2 py-1.5 bg-white border border-border/40 rounded-lg">
                    <span className="text-xs text-charcoal flex-1 truncate">{a.name}</span>
                    <div className="flex rounded-md overflow-hidden border border-border">
                      <button
                        type="button" disabled={saving}
                        onClick={() => setAnimalChoice(prev => ({ ...prev, [a.id]: 'p1' }))}
                        className={`px-2 py-0.5 text-[10px] font-bold ${target === 'p1' ? 'bg-lime-500/30 text-lime-800' : 'bg-white text-muted active:bg-cream'} disabled:opacity-40`}
                      >
                        1
                      </button>
                      <button
                        type="button" disabled={saving}
                        onClick={() => setAnimalChoice(prev => ({ ...prev, [a.id]: 'p2' }))}
                        className={`px-2 py-0.5 text-[10px] font-bold border-l border-border ${target === 'p2' ? 'bg-sky-500/30 text-sky-800' : 'bg-white text-muted active:bg-cream'} disabled:opacity-40`}
                      >
                        2
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>
        ) : (
          <p className="text-xs text-muted mb-4 italic">
            Aucun animal dans cet espace — rien à répartir.
          </p>
        )}

        <div className="space-y-2">
          <button
            onClick={() => onConfirm({ name1: name1.trim(), name2: name2.trim(), animalChoice })}
            disabled={!canConfirm}
            className="w-full py-3 rounded-xl font-bold text-white text-base bg-orange-500 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-lg"
          >
            {saving ? 'Découpage…' : 'Confirmer le découpage'}
          </button>
          <button
            onClick={onCancel} disabled={saving}
            className="w-full py-2.5 rounded-xl border border-border text-muted text-sm font-medium active:bg-cream disabled:opacity-40"
          >
            Annuler — ne rien découper
          </button>
          <p className="text-[10px] text-muted/80 text-center leading-tight">
            Si tu retires plus tard cette clôture, les 2 espaces seront refusionnés automatiquement en un seul.
          </p>
        </div>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// Helpers SVG — projection des coordonnées lat/lng vers un viewBox normalisé.
// On centre la bbox combinée p1+p2 et on inverse la latitude (SVG y vers le bas).
// ──────────────────────────────────────────────────────────────────────────────

function buildPreviewBox(split: SplitResult) {
  const all = [...split.p1, ...split.p2]
  let minLat =  Infinity, maxLat = -Infinity
  let minLng =  Infinity, maxLng = -Infinity
  for (const p of all) {
    if (p.lat < minLat) minLat = p.lat
    if (p.lat > maxLat) maxLat = p.lat
    if (p.lng < minLng) minLng = p.lng
    if (p.lng > maxLng) maxLng = p.lng
  }
  // Pad 5% pour éviter que le tracé touche le bord
  const padLat = (maxLat - minLat) * 0.05 || 1e-6
  const padLng = (maxLng - minLng) * 0.05 || 1e-6
  minLat -= padLat; maxLat += padLat
  minLng -= padLng; maxLng += padLng

  const w = 200, h = 100
  const project = (p: { lat: number; lng: number }) => {
    const x = ((p.lng - minLng) / (maxLng - minLng)) * w
    const y = h - ((p.lat - minLat) / (maxLat - minLat)) * h
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }
  return {
    viewBox: `0 0 ${w} ${h}`,
    p1Pts:   split.p1.map(project).join(' '),
    p2Pts:   split.p2.map(project).join(' '),
    cutPts:  split.cut.map(project).join(' '),
  }
}
