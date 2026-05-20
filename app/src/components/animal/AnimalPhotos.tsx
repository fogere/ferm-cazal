import { useEffect, useMemo, useState } from 'react'
import { Camera, X, Play, Pause, ChevronLeft, ChevronRight, Tag } from 'lucide-react'
import {
  doc, updateDoc, deleteDoc, addDoc, collection,
} from 'firebase/firestore'
import { db } from '../../firebase'
import { compressImage } from '../../services/image'
import type { AnimalPhoto } from '../../types'

interface Props {
  animalId:    string
  photos:      AnimalPhoto[]
  isTemp:      boolean
  currentUid?: string
}

// Tags rapides pré-définis (l'utilisateur peut aussi en saisir d'autres librement)
const QUICK_TAGS = [
  'pelage_hiver', 'pelage_été', 'après_tonte',
  'avant_après', 'profil', 'allure',
  'pré_vert', 'pré_sec',
]

function dateLabelFR(ts: number): string {
  return new Date(ts).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function AnimalPhotos({ animalId, photos, isTemp, currentUid }: Props) {
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState<'grid' | 'compare' | 'slideshow'>('grid')
  const [filter, setFilter] = useState<string | null>(null) // tag actif
  const [viewer, setViewer] = useState<AnimalPhoto | null>(null)
  const [compareA, setCompareA] = useState<AnimalPhoto | null>(null)
  const [compareB, setCompareB] = useState<AnimalPhoto | null>(null)
  const [slidePlay, setSlidePlay] = useState(true)
  const [slideIdx, setSlideIdx] = useState(0)
  const [tagEditFor, setTagEditFor] = useState<AnimalPhoto | null>(null)
  const [tagDraft, setTagDraft] = useState('')

  const sortedAsc = useMemo(
    () => [...photos].sort((a, b) => a.takenAt - b.takenAt),
    [photos],
  )
  const allTags = useMemo(() => {
    const set = new Set<string>()
    for (const p of photos) (p.tags ?? []).forEach(t => set.add(t))
    return Array.from(set).sort()
  }, [photos])

  const filtered = filter
    ? sortedAsc.filter(p => (p.tags ?? []).includes(filter))
    : sortedAsc

  // Slideshow auto
  useEffect(() => {
    if (mode !== 'slideshow' || !slidePlay || filtered.length === 0) return
    const t = setInterval(() => {
      setSlideIdx(i => (i + 1) % filtered.length)
    }, 1500)
    return () => clearInterval(t)
  }, [mode, slidePlay, filtered.length])

  // Auto-pick comparaison : la première + la dernière par défaut
  useEffect(() => {
    if (mode === 'compare' && filtered.length >= 2 && !compareA && !compareB) {
      setCompareA(filtered[0])
      setCompareB(filtered[filtered.length - 1])
    }
  }, [mode, filtered, compareA, compareB])

  async function upload(file: File) {
    if (!currentUid) return
    setBusy(true)
    try {
      const dataUrl = await compressImage(file, 1280, 0.75)
      if (dataUrl.length > 900_000) {
        alert('Photo trop lourde après compression.')
        return
      }
      await addDoc(collection(db, 'animal_photos'), {
        animalId,
        uploadedBy: currentUid,
        uploadedAt: Date.now(),
        takenAt:    Date.now(),
        dataUrl,
        category:   'general',
        tags:       [],
      })
    } catch (e) {
      console.error('[photos] upload:', e)
      alert("Échec de l'envoi de la photo.")
    } finally {
      setBusy(false)
    }
  }

  async function removePhoto(id: string) {
    if (!window.confirm('Supprimer cette photo ?')) return
    await deleteDoc(doc(db, 'animal_photos', id))
    if (viewer?.id === id) setViewer(null)
  }

  async function toggleTag(p: AnimalPhoto, tag: string) {
    const existing = p.tags ?? []
    const has = existing.includes(tag)
    const next = has ? existing.filter(t => t !== tag) : [...existing, tag]
    await updateDoc(doc(db, 'animal_photos', p.id), { tags: next })
    setTagEditFor(prev => prev?.id === p.id ? { ...prev, tags: next } : prev)
  }

  async function addCustomTag(p: AnimalPhoto) {
    const t = tagDraft.trim().toLowerCase().replace(/\s+/g, '_')
    if (!t) return
    const existing = p.tags ?? []
    if (existing.includes(t)) { setTagDraft(''); return }
    const next = [...existing, t]
    await updateDoc(doc(db, 'animal_photos', p.id), { tags: next })
    setTagEditFor(prev => prev?.id === p.id ? { ...prev, tags: next } : prev)
    setTagDraft('')
  }

  return (
    <div className="space-y-3">
      {/* Modes */}
      <div className="grid grid-cols-3 gap-1">
        {([
          ['grid',      `📷 Grille (${sortedAsc.length})`],
          ['compare',   '⇄ Comparer'],
          ['slideshow', '▶ Diaporama'],
        ] as const).map(([k, label]) => (
          <button key={k} onClick={() => setMode(k)}
                  disabled={sortedAsc.length === 0 && k !== 'grid'}
                  className={`py-1.5 rounded-lg text-[10px] font-bold transition-all disabled:opacity-30 ${
                    mode === k ? 'bg-forest text-white' : 'bg-cream text-muted border border-border'
                  }`}>
            {label}
          </button>
        ))}
      </div>

      {/* Filtres tag */}
      {allTags.length > 0 && (
        <div className="flex gap-1 overflow-x-auto -mx-1 px-1 pb-1 scrollbar-none">
          <button onClick={() => setFilter(null)}
                  className={`flex-shrink-0 px-2 py-1 rounded-lg text-[10px] font-bold whitespace-nowrap ${
                    filter === null ? 'bg-forest text-white' : 'bg-cream text-muted border border-border'
                  }`}>
            Tous
          </button>
          {allTags.map(t => (
            <button key={t} onClick={() => setFilter(t === filter ? null : t)}
                    className={`flex-shrink-0 px-2 py-1 rounded-lg text-[10px] font-bold whitespace-nowrap ${
                      filter === t ? 'bg-forest text-white' : 'bg-cream text-muted border border-border'
                    }`}>
              {t}
            </button>
          ))}
        </div>
      )}

      {/* Upload */}
      {!isTemp && (
        <label className="flex items-center justify-center gap-1 w-full py-2 rounded-lg border border-dashed border-forest text-forest text-xs font-bold cursor-pointer active:bg-forest/10">
          <Camera size={13} />
          {busy ? 'Envoi…' : '+ Ajouter une photo'}
          <input type="file" accept="image/*" className="hidden" disabled={busy}
                 onChange={e => {
                   const f = e.target.files?.[0]
                   if (f) upload(f)
                   e.target.value = ''
                 }} />
        </label>
      )}

      {/* Vue */}
      {mode === 'grid' && (
        filtered.length === 0 ? (
          <p className="text-xs text-muted text-center italic py-3">
            Aucune photo {filter ? `taggée "${filter}"` : 'encore'}.
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-1.5">
            {[...filtered].reverse().map(p => (
              <button key={p.id} onClick={() => setViewer(p)}
                      className="aspect-square rounded-lg overflow-hidden bg-cream border border-border/40 relative active:opacity-80">
                <img src={p.dataUrl} alt="" className="w-full h-full object-cover" />
                <div className="absolute bottom-0 inset-x-0 bg-charcoal/70 text-white text-[9px] py-0.5 text-center">
                  {dateLabelFR(p.takenAt)}
                </div>
                {(p.tags?.length ?? 0) > 0 && (
                  <span className="absolute top-1 left-1 bg-forest/90 text-white text-[8px] px-1 py-0.5 rounded font-bold">
                    {p.tags!.length}🏷
                  </span>
                )}
              </button>
            ))}
          </div>
        )
      )}

      {mode === 'compare' && (
        filtered.length < 2 ? (
          <p className="text-xs text-muted text-center italic py-3">
            Il faut au moins 2 photos pour comparer.
          </p>
        ) : (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <PhotoPicker label="Avant" photo={compareA} onPick={() => setViewer(null)}
                           photos={filtered} onChange={setCompareA} />
              <PhotoPicker label="Après" photo={compareB} onPick={() => setViewer(null)}
                           photos={filtered} onChange={setCompareB} />
            </div>
            {compareA && compareB && (
              <p className="text-[10px] text-center text-muted">
                Écart : {Math.abs(Math.round((compareB.takenAt - compareA.takenAt) / 86_400_000))} jours
              </p>
            )}
          </div>
        )
      )}

      {mode === 'slideshow' && filtered.length > 0 && (
        <div className="bg-charcoal rounded-xl overflow-hidden">
          <div className="aspect-square relative">
            <img src={filtered[slideIdx % filtered.length].dataUrl}
                 alt="" className="w-full h-full object-contain" />
            <div className="absolute top-2 right-2 bg-black/60 text-white text-[10px] px-2 py-0.5 rounded-full">
              {slideIdx + 1} / {filtered.length}
            </div>
            <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 to-transparent px-3 py-2 text-white">
              <p className="text-xs font-bold m-0">
                {dateLabelFR(filtered[slideIdx % filtered.length].takenAt)}
              </p>
              {(filtered[slideIdx % filtered.length].tags ?? []).length > 0 && (
                <p className="text-[10px] opacity-80 m-0">
                  {filtered[slideIdx % filtered.length].tags!.join(' · ')}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center justify-center gap-3 py-2 bg-charcoal/80">
            <button onClick={() => setSlideIdx(i => (i - 1 + filtered.length) % filtered.length)}
                    className="p-2 text-white/80 active:text-white">
              <ChevronLeft size={18} />
            </button>
            <button onClick={() => setSlidePlay(p => !p)}
                    className="p-2 text-white/80 active:text-white bg-white/10 rounded-full">
              {slidePlay ? <Pause size={16} /> : <Play size={16} />}
            </button>
            <button onClick={() => setSlideIdx(i => (i + 1) % filtered.length)}
                    className="p-2 text-white/80 active:text-white">
              <ChevronRight size={18} />
            </button>
          </div>
        </div>
      )}

      {/* Viewer fullscreen */}
      {viewer && (
        <div className="fixed inset-0 z-[4000] bg-black/95 flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 text-white">
            <p className="text-sm font-semibold">{dateLabelFR(viewer.takenAt)}</p>
            <div className="flex gap-1">
              {!isTemp && (
                <>
                  <button onClick={() => { setTagEditFor(viewer); setTagDraft('') }}
                          className="p-2 rounded-xl text-white/80 active:bg-white/15"
                          title="Éditer les tags">
                    <Tag size={18} />
                  </button>
                  <button onClick={() => removePhoto(viewer.id)}
                          className="p-2 rounded-xl text-white/80 active:bg-white/15">
                    <X size={18} />
                  </button>
                </>
              )}
              <button onClick={() => setViewer(null)}
                      className="p-2 rounded-xl text-white/80 active:bg-white/15">
                <X size={22} />
              </button>
            </div>
          </div>
          <div className="flex-1 flex items-center justify-center px-2 pb-4">
            <img src={viewer.dataUrl} alt="" className="max-w-full max-h-full object-contain" />
          </div>
          {(viewer.tags?.length ?? 0) > 0 && (
            <div className="px-4 pb-4 flex flex-wrap gap-1 justify-center">
              {viewer.tags!.map(t => (
                <span key={t} className="bg-white/15 text-white text-[10px] px-2 py-0.5 rounded-full">
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tag editor sheet */}
      {tagEditFor && (
        <div className="fixed inset-0 z-[5000] bg-black/70 flex items-end sm:items-center justify-center"
             onClick={() => setTagEditFor(null)}>
          <div className="bg-card w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl p-4 max-h-[85vh] overflow-y-auto"
               onClick={e => e.stopPropagation()}>
            <p className="text-sm font-bold text-charcoal mb-2">Tags de la photo</p>
            <p className="text-[10px] text-muted mb-3">
              Touche un tag pour l'activer / le retirer.
            </p>
            <div className="flex flex-wrap gap-1 mb-3">
              {[...new Set([...QUICK_TAGS, ...(tagEditFor.tags ?? [])])].map(t => {
                const active = (tagEditFor.tags ?? []).includes(t)
                return (
                  <button key={t}
                          onClick={() => toggleTag(tagEditFor, t)}
                          className={`px-2 py-1 rounded-full text-[10px] font-bold border ${
                            active
                              ? 'bg-forest text-white border-forest'
                              : 'bg-white text-muted border-border'
                          }`}>
                    {t}
                  </button>
                )
              })}
            </div>
            <div className="flex gap-2">
              <input type="text" value={tagDraft}
                     onChange={e => setTagDraft(e.target.value)}
                     placeholder="ajouter_un_tag…"
                     className="flex-1 px-2 py-1.5 rounded-lg border border-border bg-white text-xs" />
              <button onClick={() => addCustomTag(tagEditFor)}
                      className="px-3 py-1.5 rounded-lg bg-forest text-white text-xs font-bold">
                +
              </button>
            </div>
            <button onClick={() => setTagEditFor(null)}
                    className="w-full mt-3 py-2 rounded-lg bg-cream text-charcoal text-xs font-bold">
              Fermer
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function PhotoPicker({
  label, photo, photos, onChange,
}: {
  label: string
  photo: AnimalPhoto | null
  photos: AnimalPhoto[]
  onPick: () => void
  onChange: (p: AnimalPhoto) => void
}) {
  const [pick, setPick] = useState(false)
  return (
    <div>
      <p className="text-[10px] font-bold text-muted uppercase tracking-wider mb-1">{label}</p>
      <button onClick={() => setPick(true)}
              className="w-full aspect-square rounded-xl bg-cream border-2 border-border overflow-hidden relative active:opacity-80">
        {photo ? (
          <>
            <img src={photo.dataUrl} alt="" className="w-full h-full object-cover" />
            <div className="absolute bottom-0 inset-x-0 bg-charcoal/70 text-white text-[9px] py-0.5 text-center">
              {dateLabelFR(photo.takenAt)}
            </div>
          </>
        ) : (
          <span className="text-[11px] text-muted">Choisir une photo</span>
        )}
      </button>
      {pick && (
        <div className="fixed inset-0 z-[5000] bg-black/70 flex items-end justify-center"
             onClick={() => setPick(false)}>
          <div className="bg-card w-full max-w-md rounded-t-3xl p-4 max-h-[80vh] overflow-y-auto"
               onClick={e => e.stopPropagation()}>
            <p className="text-sm font-bold text-charcoal mb-3">Photo pour "{label}"</p>
            <div className="grid grid-cols-3 gap-1.5">
              {photos.map(p => (
                <button key={p.id}
                        onClick={() => { onChange(p); setPick(false) }}
                        className="aspect-square rounded overflow-hidden bg-cream border border-border/40 relative">
                  <img src={p.dataUrl} alt="" className="w-full h-full object-cover" />
                  <div className="absolute bottom-0 inset-x-0 bg-charcoal/70 text-white text-[8px] py-0.5 text-center">
                    {dateLabelFR(p.takenAt)}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
