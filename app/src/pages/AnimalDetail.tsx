import { useEffect, useMemo, useState, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  collection, doc, onSnapshot, query, where, updateDoc, addDoc, deleteDoc,
} from 'firebase/firestore'
import { X, Plus, Check, Calendar, Stethoscope, Trash2 } from 'lucide-react'
import { db } from '../firebase'
import {
  dateInputToTs,
  tsToDateInput as todayInputValue,
} from '../services/map/time'
import { useAuth } from '../hooks/useAuth'
import { useCustomSpecies } from '../hooks/useCustomSpecies'
import { getSpeciesInfo } from '../services/species'
import { compressImage } from '../services/image'
import type {
  Animal, AnimalCareEntry, AnimalCondition, AnimalMeasurement, AnimalPhoto,
  EnclosureMovement, UserProfile,
} from '../types'

import AnimalHeader      from '../components/animal/AnimalHeader'
import AnimalTimeline    from '../components/animal/AnimalTimeline'
import AnimalGrowth      from '../components/animal/AnimalGrowth'
import AnimalPhotos      from '../components/animal/AnimalPhotos'
import AnimalLineage     from '../components/animal/AnimalLineage'
import AnimalReproduction from '../components/animal/AnimalReproduction'

type Tab = 'timeline' | 'growth' | 'health' | 'photos' | 'care' | 'family' | 'identity'

export default function AnimalDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user, isTemp } = useAuth()
  const customSpecies = useCustomSpecies()

  const [animal,       setAnimal]       = useState<Animal | null>(null)
  const [allAnimals,   setAllAnimals]   = useState<Animal[]>([])
  const [users,        setUsers]        = useState<UserProfile[]>([])
  const [careEntries,  setCareEntries]  = useState<AnimalCareEntry[]>([])
  const [photos,       setPhotos]       = useState<AnimalPhoto[]>([])
  const [measurements, setMeasurements] = useState<AnimalMeasurement[]>([])
  const [movements,    setMovements]    = useState<EnclosureMovement[]>([])

  const [tab, setTab] = useState<Tab>('timeline')
  const [busyHealth, setBusyHealth] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ─── Subscriptions ───
  useEffect(() => {
    if (!id) return
    const unsub = onSnapshot(doc(db, 'animals', id), snap => {
      setAnimal(snap.exists() ? ({ id: snap.id, ...snap.data() } as Animal) : null)
    }, err => console.warn('[animal] doc:', err.code))
    return unsub
  }, [id])

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'animals'), snap => {
      setAllAnimals(snap.docs.map(d => ({ id: d.id, ...d.data() } as Animal)))
    }, err => console.warn('[animal] all:', err.code))
    return unsub
  }, [])

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'users'), snap => {
      setUsers(snap.docs.map(d => ({ uid: d.id, ...d.data() } as UserProfile)))
    }, err => console.warn('[animal] users:', err.code))
    return unsub
  }, [])

  useEffect(() => {
    if (!id) return
    // Pas d'orderBy ici : combiné à where ça exige un index composite Firestore
    // (failed-precondition). On trie côté client — 50 soins max par animal, négligeable.
    const unsub = onSnapshot(
      query(collection(db, 'animal_care'), where('animalId', '==', id)),
      snap => {
        const items = snap.docs.map(d => ({ id: d.id, ...d.data() } as AnimalCareEntry))
        items.sort((a, b) => b.date - a.date)
        setCareEntries(items)
      },
      err => console.warn('[animal] care:', err.code),
    )
    return unsub
  }, [id])

  useEffect(() => {
    if (!id) return
    const unsub = onSnapshot(
      query(collection(db, 'animal_photos'), where('animalId', '==', id)),
      snap => {
        const items = snap.docs.map(d => ({ id: d.id, ...d.data() } as AnimalPhoto))
        items.sort((a, b) => b.takenAt - a.takenAt)
        setPhotos(items)
      },
      err => console.warn('[animal] photos:', err.code),
    )
    return unsub
  }, [id])

  useEffect(() => {
    if (!id) return
    const unsub = onSnapshot(
      query(collection(db, 'animal_measurements'), where('animalId', '==', id)),
      snap => {
        const items = snap.docs.map(d => ({ id: d.id, ...d.data() } as AnimalMeasurement))
        items.sort((a, b) => a.date - b.date)
        setMeasurements(items)
      },
      err => console.warn('[animal] measurements:', err.code),
    )
    return unsub
  }, [id])

  useEffect(() => {
    if (!id) return
    const unsub = onSnapshot(
      query(collection(db, 'enclosure_movements'), where('animalId', '==', id)),
      snap => {
        const items = snap.docs.map(d => ({ id: d.id, ...d.data() } as EnclosureMovement))
        items.sort((a, b) => b.movedAt - a.movedAt)
        setMovements(items)
      },
      err => console.warn('[animal] moves:', err.code),
    )
    return unsub
  }, [id])

  const species = useMemo(
    () => animal ? getSpeciesInfo(animal.species, customSpecies) : { emoji: '🐾', label: '—' },
    [animal, customSpecies],
  )

  const conditions = animal?.conditions ?? []

  /* ─── Actions ─── */
  async function markHealthy() {
    if (!animal || !user || isTemp) return
    setBusyHealth(true)
    try {
      await updateDoc(doc(db, 'animals', animal.id), {
        lastCheckedHealthy:   Date.now(),
        lastCheckedHealthyBy: user.uid,
      })
    } finally { setBusyHealth(false) }
  }

  async function handlePhoto(file: File) {
    if (!animal || !user) return
    const dataUrl = await compressImage(file, 1280, 0.75)
    if (dataUrl.length > 900_000) {
      alert('Photo trop lourde après compression.')
      return
    }
    await addDoc(collection(db, 'animal_photos'), {
      animalId:   animal.id,
      uploadedBy: user.uid,
      uploadedAt: Date.now(),
      takenAt:    Date.now(),
      dataUrl,
      category:   'general',
      tags:       [],
    })
    setTab('photos')
  }

  function triggerAddPhoto() {
    fileInputRef.current?.click()
  }

  function printCarnet() {
    window.print()
  }

  if (!animal) {
    return (
      <div className="flex h-full items-center justify-center bg-cream">
        <p className="text-sm text-muted">Chargement de la fiche…</p>
      </div>
    )
  }

  const isFemale = animal.gender === 'female' || animal.gender === 'mare'
  const tabs: [Tab, string][] = [
    ['timeline', '📅 Frise'],
    ['growth',   '📈 Croissance'],
    ['health',   `🩺 Santé${conditions.filter(c => !c.resolvedAt).length > 0
      ? ` (${conditions.filter(c => !c.resolvedAt).length})` : ''}`],
    ['photos',   `📸 Photos${photos.length > 0 ? ` (${photos.length})` : ''}`],
    ['care',     `💉 Soins${careEntries.length > 0 ? ` (${careEntries.length})` : ''}`],
    ['family',   `🌳 Famille${isFemale ? ' & repro.' : ''}`],
    ['identity', '📋 Identité'],
  ]

  return (
    <div className="min-h-full bg-cream pb-12 print:bg-white">
      <input ref={fileInputRef} type="file" accept="image/*" capture="environment"
             className="hidden"
             onChange={e => {
               const f = e.target.files?.[0]
               if (f) handlePhoto(f).catch(() => {})
               e.target.value = ''
             }} />

      <AnimalHeader
        animal={animal}
        species={species}
        careEntries={careEntries}
        measurements={measurements}
        users={users}
        isTemp={isTemp}
        onBack={() => navigate(-1)}
        onMarkHealthy={markHealthy}
        onAddPhoto={triggerAddPhoto}
        onPrint={printCarnet}
        busyHealth={busyHealth}
      />

      {/* Onglets scrollables horizontalement */}
      <div className="sticky top-0 z-10 bg-card border-b border-border print:hidden">
        <div className="flex gap-1 px-2 py-2 overflow-x-auto scrollbar-none">
          {tabs.map(([k, label]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`flex-shrink-0 py-1.5 px-3 rounded-lg text-[11px] font-bold whitespace-nowrap transition-all ${
                tab === k ? 'bg-forest text-white' : 'bg-cream text-muted border border-border'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="p-3 space-y-3 print:p-6">
        {tab === 'timeline' && (
          <AnimalTimeline
            careEntries={careEntries}
            photos={photos}
            measurements={measurements}
            conditions={conditions}
            movements={movements}
            users={users}
          />
        )}

        {tab === 'growth' && (
          <AnimalGrowth
            animalId={animal.id}
            measurements={measurements}
            users={users}
            isTemp={isTemp}
            currentUid={user?.uid}
          />
        )}

        {tab === 'health' && (
          <HealthPanel animal={animal} photos={photos} isTemp={isTemp} currentUid={user?.uid} />
        )}

        {tab === 'photos' && (
          <AnimalPhotos
            animalId={animal.id}
            photos={photos}
            isTemp={isTemp}
            currentUid={user?.uid}
          />
        )}

        {tab === 'care' && (
          <CarePanel animal={animal} careEntries={careEntries} users={users} isTemp={isTemp} currentUid={user?.uid} />
        )}

        {tab === 'family' && (
          <>
            <AnimalLineage
              animal={animal}
              allAnimals={allAnimals}
              customSpecies={customSpecies}
              onNavigate={(otherId) => navigate(`/animal/${otherId}`)}
            />
            {isFemale && (
              <div className="mt-4">
                <h3 className="text-xs font-bold text-muted uppercase tracking-wider mb-2 pl-1">
                  Reproduction
                </h3>
                <AnimalReproduction
                  animal={animal}
                  careEntries={careEntries}
                  customSpecies={customSpecies}
                />
              </div>
            )}
          </>
        )}

        {tab === 'identity' && (
          <IdentityPanel
            animal={animal}
            allAnimals={allAnimals}
            isTemp={isTemp}
          />
        )}
      </div>

      {/* Section imprimable masquée à l'écran, montrée à l'impression */}
      <div className="hidden print:block p-6">
        <h2 className="text-2xl font-bold m-0 mb-1">{animal.name}</h2>
        <p className="text-sm text-muted mb-2">
          {species.label} · {animal.gender ?? '—'}
          {animal.birthDate && ` · né(e) le ${new Date(animal.birthDate).toLocaleDateString('fr-FR')}`}
        </p>
        {(animal.sireNumber || animal.transponderId) && (
          <div className="mb-4 text-xs">
            {animal.sireNumber && <p className="m-0"><strong>SIRE :</strong> <span className="font-mono">{animal.sireNumber}</span></p>}
            {animal.transponderId && <p className="m-0"><strong>Transpondeur :</strong> <span className="font-mono">{animal.transponderId}</span></p>}
          </div>
        )}
        <h3 className="text-base font-bold mb-2">Carnet de soins</h3>
        {careEntries.length === 0
          ? <p className="text-sm text-muted">Aucun soin enregistré.</p>
          : (
            <table className="w-full text-xs">
              <thead><tr><th className="text-left">Date</th><th>Type</th><th className="text-left">Note</th></tr></thead>
              <tbody>
                {careEntries.map(c => (
                  <tr key={c.id}>
                    <td>{new Date(c.date).toLocaleDateString('fr-FR')}</td>
                    <td>{c.type}</td>
                    <td>{c.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </div>
    </div>
  )
}

/* ─── Sous-panneaux extraits dans la page pour rester contenus ─── */

function dateLabelFR(ts: number): string {
  return new Date(ts).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })
}

function HealthPanel({ animal, photos, isTemp, currentUid }: {
  animal: Animal
  photos: AnimalPhoto[]
  isTemp: boolean
  currentUid?: string
}) {
  const conditions = animal.conditions ?? []
  const active = conditions.filter(c => !c.resolvedAt)
  const resolved = conditions.filter(c => !!c.resolvedAt)

  const [newOpen, setNewOpen] = useState(false)
  const [label, setLabel] = useState('')
  const [desc, setDesc] = useState('')
  const [genetic, setGenetic] = useState(false)
  const [contag, setContag] = useState(false)
  const [perm, setPerm] = useState(true)

  async function addCondition() {
    if (!label.trim() || !currentUid) return
    const cond: AnimalCondition = {
      id:           `cond_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      label:        label.trim(),
      description:  desc.trim(),
      isGenetic:    genetic,
      isContagious: contag,
      permanent:    perm,
      addedAt:      Date.now(),
      addedBy:      currentUid,
    }
    await updateDoc(doc(db, 'animals', animal.id), { conditions: [...conditions, cond] } as never)
    setLabel(''); setDesc(''); setGenetic(false); setContag(false); setPerm(true)
    setNewOpen(false)
  }

  async function resolve(id: string) {
    await updateDoc(doc(db, 'animals', animal.id), {
      conditions: conditions.map(c => c.id === id ? { ...c, resolvedAt: Date.now() } : c),
    } as never)
  }
  async function remove(id: string) {
    if (!window.confirm('Supprimer définitivement cette condition ?')) return
    await updateDoc(doc(db, 'animals', animal.id), {
      conditions: conditions.filter(c => c.id !== id),
    } as never)
  }

  return (
    <div className="space-y-2">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-1.5">
        <StatCell label="Actifs" value={active.length} tone={active.length > 0 ? 'warn' : 'good'} />
        <StatCell label="Résolus" value={resolved.length} tone="neutral" />
        <StatCell label="Héréd." value={conditions.filter(c => c.isGenetic).length} tone="neutral" />
      </div>

      {!isTemp && (newOpen ? (
        <div className="space-y-2 border border-forest/30 bg-forest/5 rounded-lg p-2.5">
          <input value={label} onChange={e => setLabel(e.target.value)}
                 placeholder="Nom (Boiterie, Asthme…)"
                 className="w-full px-2 py-1.5 rounded-lg border border-border bg-white text-xs" />
          <textarea value={desc} onChange={e => setDesc(e.target.value)}
                    placeholder="Description (cause, symptômes, traitement)"
                    rows={2}
                    className="w-full px-2 py-1.5 rounded-lg border border-border bg-white text-xs resize-none" />
          <div className="flex flex-wrap gap-2 text-[11px]">
            <label className="flex items-center gap-1 text-charcoal">
              <input type="checkbox" checked={perm} onChange={e => setPerm(e.target.checked)} /> À vie
            </label>
            <label className="flex items-center gap-1 text-charcoal">
              <input type="checkbox" checked={genetic} onChange={e => setGenetic(e.target.checked)} /> 🧬 Génétique
            </label>
            <label className="flex items-center gap-1 text-charcoal">
              <input type="checkbox" checked={contag} onChange={e => setContag(e.target.checked)} /> ☣ Contagieux
            </label>
          </div>
          <div className="flex gap-2">
            <button onClick={addCondition} disabled={!label.trim()}
                    className="flex-1 py-1.5 bg-forest text-white rounded-lg text-xs font-bold disabled:opacity-40">
              Enregistrer
            </button>
            <button onClick={() => setNewOpen(false)}
                    className="px-3 py-1.5 rounded-lg border border-border text-xs text-muted">
              Annuler
            </button>
          </div>
        </div>
      ) : (
        <button onClick={() => setNewOpen(true)}
                className="w-full py-2 rounded-lg border border-dashed border-forest text-forest text-xs font-bold
                           active:bg-forest/10 flex items-center justify-center gap-1">
          <Plus size={12} /> Ajouter un problème de santé
        </button>
      ))}

      {active.length === 0 && resolved.length === 0 ? (
        <p className="text-xs text-muted text-center italic py-3">
          Aucun problème de santé enregistré.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {[...active, ...resolved].map(c => {
            const condPhotos = photos.filter(p => p.conditionId === c.id)
            const isResolved = !!c.resolvedAt
            return (
              <li key={c.id}
                  className={`bg-white rounded-lg p-2 border ${
                    isResolved ? 'border-meadow/30 opacity-70'
                      : c.permanent ? 'border-danger/30' : 'border-sun/30'
                  }`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className={`text-xs font-bold ${
                      isResolved ? 'text-meadow line-through'
                        : c.permanent ? 'text-danger' : 'text-sun'
                    }`}>
                      {c.permanent ? '🔴' : '🟡'} {c.label}{isResolved && ' ✓ résolu'}
                    </p>
                    {c.description && (
                      <p className="text-[11px] text-charcoal mt-0.5 leading-snug">{c.description}</p>
                    )}
                    <div className="flex flex-wrap gap-1 mt-1">
                      {c.isGenetic    && <span className="text-[9px] bg-pink-100 text-pink-700 px-1.5 py-0.5 rounded font-bold">🧬 Héréditaire</span>}
                      {c.isContagious && <span className="text-[9px] bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded font-bold">☣ Contagieux</span>}
                      <span className="text-[9px] text-muted">· ajouté {dateLabelFR(c.addedAt)}</span>
                    </div>
                    {condPhotos.length > 0 && (
                      <div className="mt-2 grid grid-cols-4 gap-1">
                        {condPhotos.map(p => (
                          <div key={p.id} className="aspect-square rounded overflow-hidden bg-cream border border-border/40 relative">
                            <img src={p.dataUrl} alt="" className="w-full h-full object-cover" />
                            <div className="absolute bottom-0 inset-x-0 bg-charcoal/70 text-white text-[8px] py-0.5 text-center">
                              {dateLabelFR(p.takenAt)}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  {!isTemp && (
                    <div className="flex gap-1 flex-shrink-0">
                      {!isResolved && !c.permanent && (
                        <button onClick={() => resolve(c.id)}
                                className="text-meadow active:opacity-60 p-1" title="Marquer comme résolu">
                          <Check size={12} />
                        </button>
                      )}
                      <button onClick={() => remove(c.id)}
                              className="text-danger/40 active:text-danger p-1">
                        <X size={12} />
                      </button>
                    </div>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function StatCell({ label, value, tone }: { label: string; value: number; tone: 'good' | 'warn' | 'neutral' }) {
  const color = tone === 'good' ? 'text-meadow' : tone === 'warn' ? 'text-sun' : 'text-charcoal'
  return (
    <div className="bg-white rounded-lg p-2 border border-border/40 text-center">
      <p className={`text-lg font-bold m-0 ${color}`}>{value}</p>
      <p className="text-[9px] text-muted uppercase tracking-wider m-0">{label}</p>
    </div>
  )
}

const CARE_CFG_LOCAL = {
  vaccine:    { icon: '💉', label: 'Vaccin',     color: 'text-sky' },
  vermifuge:  { icon: '💊', label: 'Vermifuge',  color: 'text-meadow' },
  parage:     { icon: '🐴', label: 'Parage',     color: 'text-earth' },
  vet_visit:  { icon: '🩺', label: 'Visite véto', color: 'text-forest' },
  medication: { icon: '🧪', label: 'Soin',       color: 'text-orange-600' },
  breeding:   { icon: '💕', label: 'Saillie',    color: 'text-pink-600' },
  birth:      { icon: '🐣', label: 'Mise bas',   color: 'text-meadow' },
  food:       { icon: '🥣', label: 'Croquettes', color: 'text-orange-600' },
  grooming:   { icon: '✂️', label: 'Toilettage', color: 'text-sky' },
  other:      { icon: '📝', label: 'Autre',      color: 'text-muted' },
} as const
type CareKey = keyof typeof CARE_CFG_LOCAL

function CarePanel({ animal, careEntries, users, isTemp, currentUid }: {
  animal: Animal
  careEntries: AnimalCareEntry[]
  users: UserProfile[]
  isTemp: boolean
  currentUid?: string
}) {
  const [open, setOpen] = useState(false)
  const [type, setType] = useState<CareKey>('vaccine')
  const [date, setDate] = useState(todayInputValue())
  const [note, setNote] = useState('')
  const [nextDue, setNextDue] = useState('')
  const [recur, setRecur] = useState(0)
  const [saving, setSaving] = useState(false)

  // Compteurs par type
  const counts = useMemo(() => {
    const c: Partial<Record<CareKey, number>> = {}
    for (const e of careEntries) c[e.type as CareKey] = (c[e.type as CareKey] ?? 0) + 1
    return c
  }, [careEntries])

  const overdueCount = careEntries.filter(e => e.nextDueAt && e.nextDueAt < Date.now()).length

  async function save() {
    if (!currentUid || isTemp) return
    setSaving(true)
    try {
      const dateTs = dateInputToTs(date)
      const autoNext = recur > 0 ? dateTs + recur * 86_400_000 : undefined
      const entry: Omit<AnimalCareEntry, 'id'> = {
        animalId:    animal.id,
        type,
        date:        dateTs,
        note:        note.trim(),
        performedBy: currentUid,
        createdAt:   Date.now(),
        ...(nextDue
          ? { nextDueAt: dateInputToTs(nextDue) }
          : autoNext
            ? { nextDueAt: autoNext }
            : {}),
        ...(recur > 0 && { recurrenceDays: recur }),
      }
      await addDoc(collection(db, 'animal_care'), entry)
      setNote(''); setNextDue(''); setRecur(0)
      setOpen(false)
    } finally {
      setSaving(false)
    }
  }

  async function repeat(e: AnimalCareEntry) {
    if (!currentUid || !e.recurrenceDays) return
    const today = Date.now()
    await addDoc(collection(db, 'animal_care'), {
      animalId:       e.animalId,
      type:           e.type,
      date:           today,
      note:           e.note,
      performedBy:    currentUid,
      createdAt:      today,
      nextDueAt:      today + e.recurrenceDays * 86_400_000,
      recurrenceDays: e.recurrenceDays,
    })
  }

  async function removeCare(id: string) {
    await deleteDoc(doc(db, 'animal_care', id))
  }

  return (
    <div className="space-y-2">
      {/* Compteurs + alerte overdue */}
      {overdueCount > 0 && (
        <div className="bg-danger/10 border border-danger/40 rounded-lg p-2 text-[11px] text-danger font-bold flex items-center gap-1">
          ⏰ {overdueCount} rappel{overdueCount > 1 ? 's' : ''} en retard
        </div>
      )}
      <div className="grid grid-cols-5 gap-1">
        {(['vaccine', 'vermifuge', 'parage', 'vet_visit', 'medication'] as CareKey[]).map(k => (
          <div key={k} className="bg-white rounded-lg p-1.5 border border-border/40 text-center">
            <p className="text-base m-0">{CARE_CFG_LOCAL[k].icon}</p>
            <p className="text-[9px] text-muted m-0 leading-tight">{CARE_CFG_LOCAL[k].label}</p>
            <p className="text-xs font-bold text-charcoal m-0">{counts[k] ?? 0}</p>
          </div>
        ))}
      </div>

      {!isTemp && (open ? (
        <div className="bg-cream rounded-xl p-3 space-y-2 border border-forest/20">
          <div className="flex items-center gap-1.5 mb-1">
            <Stethoscope size={13} className="text-forest" />
            <p className="text-xs font-bold text-forest">Nouveau soin</p>
          </div>
          <div className="grid grid-cols-3 gap-1">
            {(Object.entries(CARE_CFG_LOCAL) as [CareKey, typeof CARE_CFG_LOCAL.other][]).map(([k, v]) => (
              <button key={k} onClick={() => setType(k)}
                      className={`flex flex-col items-center gap-0.5 py-2 rounded-lg border text-xs font-semibold transition-all ${
                        type === k ? 'border-forest bg-forest/10 text-forest' : 'border-border bg-white text-muted'
                      }`}>
                <span className="text-base leading-none">{v.icon}</span>
                <span className="text-[10px]">{v.label}</span>
              </button>
            ))}
          </div>
          <div className="flex gap-2 items-center">
            <Calendar size={13} className="text-muted flex-shrink-0" />
            <input type="date" value={date} onChange={e => setDate(e.target.value)}
                   className="flex-1 px-2 py-1.5 rounded-lg border border-border bg-white text-xs" />
          </div>
          <input type="text" value={note} onChange={e => setNote(e.target.value)}
                 placeholder="Note (optionnelle)"
                 className="w-full px-2 py-1.5 rounded-lg border border-border bg-white text-xs" />
          <div className="flex gap-2 items-center">
            <span className="text-xs text-muted flex-shrink-0">Rappel:</span>
            <input type="date" value={nextDue} onChange={e => setNextDue(e.target.value)}
                   className="flex-1 px-2 py-1.5 rounded-lg border border-border bg-white text-xs" />
          </div>
          <div>
            <p className="text-[10px] font-bold text-muted uppercase tracking-wider mb-1">Récurrence</p>
            <div className="grid grid-cols-6 gap-1">
              {([
                [0,   'Jamais'],
                [7,   '1 sem.'],
                [30,  '1 mois'],
                [90,  '3 mois'],
                [180, '6 mois'],
                [365, '1 an'],
              ] as [number, string][]).map(([d, label]) => (
                <button key={d} onClick={() => setRecur(d)}
                        className={`py-1.5 rounded-lg text-[10px] font-semibold border transition-all ${
                          recur === d ? 'border-forest bg-forest/10 text-forest' : 'border-border bg-white text-muted'
                        }`}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={save} disabled={saving}
                    className="flex-1 py-2 rounded-lg bg-forest text-white text-xs font-bold disabled:opacity-40">
              {saving ? '…' : 'Enregistrer'}
            </button>
            <button onClick={() => setOpen(false)}
                    className="px-3 py-2 rounded-lg border border-border text-xs text-muted">
              Annuler
            </button>
          </div>
        </div>
      ) : (
        <button onClick={() => setOpen(true)}
                className="w-full py-2 rounded-lg border border-dashed border-forest text-forest text-xs font-bold
                           active:bg-forest/10 flex items-center justify-center gap-1">
          <Plus size={12} /> Nouveau soin
        </button>
      ))}

      {careEntries.length === 0 ? (
        <p className="text-xs text-muted text-center italic py-3">
          Aucun soin enregistré.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {careEntries.map(e => {
            const cfg = CARE_CFG_LOCAL[e.type as CareKey] ?? CARE_CFG_LOCAL.other
            const dueOverdue = e.nextDueAt && e.nextDueAt < Date.now()
            const canRepeat  = !!e.recurrenceDays && !isTemp
            return (
              <li key={e.id} className="flex items-start gap-2 bg-white rounded-lg p-2 border border-border/40">
                <span className="text-base flex-shrink-0">{cfg.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className={`text-xs font-bold ${cfg.color}`}>
                      {cfg.label} <span className="text-muted font-normal">· {dateLabelFR(e.date)}</span>
                      {e.recurrenceDays && (
                        <span className="ml-1 text-[9px] bg-meadow/15 text-meadow px-1 py-0.5 rounded font-bold">
                          ↻ tous les {e.recurrenceDays} j
                        </span>
                      )}
                    </p>
                    {!isTemp && (
                      <button onClick={() => removeCare(e.id)}
                              className="text-danger/30 active:text-danger p-0.5">
                        <Trash2 size={11} />
                      </button>
                    )}
                  </div>
                  {e.note && <p className="text-xs text-charcoal mt-0.5 leading-snug">{e.note}</p>}
                  <p className="text-[9px] text-muted">
                    par {users.find(u => u.uid === e.performedBy)?.displayName ?? '—'}
                  </p>
                  {e.nextDueAt && (
                    <p className={`text-[11px] mt-0.5 ${dueOverdue ? 'text-danger font-semibold' : 'text-muted'}`}>
                      ⏰ Prochain : {dateLabelFR(e.nextDueAt)}
                    </p>
                  )}
                  {canRepeat && dueOverdue && (
                    <button onClick={() => repeat(e)}
                            className="mt-1.5 px-2 py-1 rounded-lg bg-meadow/10 text-meadow text-[10px] font-bold border border-meadow/30 active:bg-meadow/20">
                      ✓ Fait aujourd'hui · relancer le rappel
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function IdentityPanel({ animal, allAnimals, isTemp }: {
  animal: Animal
  allAnimals: Animal[]
  isTemp: boolean
}) {
  async function update(patch: Partial<Animal>) {
    if (isTemp) return
    try {
      await updateDoc(doc(db, 'animals', animal.id), patch as never)
    } catch (e) {
      console.error('[identity] update:', e)
    }
  }

  return (
    <div className="space-y-3">
      <Field label="Date de naissance">
        <div className="flex gap-2 items-center">
          <input
            type="date"
            value={animal.birthDate ? todayInputValue(animal.birthDate) : ''}
            disabled={isTemp}
            onChange={e => update({ birthDate: e.target.value ? dateInputToTs(e.target.value) : undefined })}
            className="flex-1 px-2 py-1.5 rounded-lg border border-border bg-white text-xs disabled:opacity-50"
          />
          <label className="text-[11px] text-muted flex items-center gap-1">
            <input type="checkbox" checked={!!animal.birthEstimated} disabled={isTemp}
                   onChange={e => update({ birthEstimated: e.target.checked })} />
            estimée
          </label>
        </div>
      </Field>

      <Field label="Sexe">
        <div className="grid grid-cols-3 gap-1">
          {([
            ['male',    '♂ Mâle'],
            ['female',  '♀ Femelle'],
            ['gelding', 'Hongre'],
            ['mare',    'Jument'],
            ['unknown', '? Inconnu'],
          ] as const).map(([k, label]) => (
            <button key={k} disabled={isTemp}
                    onClick={() => update({ gender: k })}
                    className={`py-1.5 rounded-lg text-[11px] font-semibold border transition-all ${
                      animal.gender === k
                        ? 'border-forest bg-forest/10 text-forest'
                        : 'border-border bg-white text-muted'
                    } disabled:opacity-50`}>
              {label}
            </button>
          ))}
        </div>
        <label className="text-[11px] text-muted flex items-center gap-1 mt-2">
          <input type="checkbox" checked={!!animal.neutered} disabled={isTemp}
                 onChange={e => update({ neutered: e.target.checked })} />
          Castré / stérilisé
        </label>
      </Field>

      <Field label="Parents">
        <div className="space-y-1.5">
          <select value={animal.sireId ?? ''} disabled={isTemp}
                  onChange={e => update({ sireId: e.target.value || undefined })}
                  className="w-full px-2 py-1.5 rounded-lg border border-border bg-white text-xs disabled:opacity-50">
            <option value="">Père : (inconnu)</option>
            {allAnimals.filter(p => p.id !== animal.id).map(p => (
              <option key={p.id} value={p.id}>♂ {p.name}</option>
            ))}
          </select>
          <select value={animal.damId ?? ''} disabled={isTemp}
                  onChange={e => update({ damId: e.target.value || undefined })}
                  className="w-full px-2 py-1.5 rounded-lg border border-border bg-white text-xs disabled:opacity-50">
            <option value="">Mère : (inconnue)</option>
            {allAnimals.filter(p => p.id !== animal.id).map(p => (
              <option key={p.id} value={p.id}>♀ {p.name}</option>
            ))}
          </select>
        </div>
      </Field>

      <Field label="Numéro SIRE (IFCE)">
        <input
          type="text"
          defaultValue={animal.sireNumber ?? ''}
          disabled={isTemp}
          maxLength={8}
          onBlur={e => {
            const v = e.target.value.trim().toUpperCase()
            if (v !== (animal.sireNumber ?? '')) {
              if (v && !/^[A-Z0-9]{8}$/.test(v)) {
                alert('Le numéro SIRE doit faire exactement 8 caractères alphanumériques.')
                e.target.value = animal.sireNumber ?? ''
                return
              }
              update({ sireNumber: v || undefined })
            }
          }}
          placeholder="00FRA12345"
          className="w-full px-2 py-1.5 rounded-lg border border-border bg-white text-xs font-mono uppercase disabled:opacity-50"
        />
        <p className="text-[10px] text-muted mt-1">8 caractères · obligatoire pour les équidés français</p>
      </Field>

      <Field label="Transpondeur (puce ISO 11784)">
        <input
          type="text"
          defaultValue={animal.transponderId ?? ''}
          disabled={isTemp}
          maxLength={15}
          inputMode="numeric"
          onBlur={e => {
            const v = e.target.value.replace(/\s+/g, '').trim()
            if (v !== (animal.transponderId ?? '')) {
              if (v && !/^\d{15}$/.test(v)) {
                alert('Le transpondeur doit faire exactement 15 chiffres.')
                e.target.value = animal.transponderId ?? ''
                return
              }
              update({ transponderId: v || undefined })
            }
          }}
          placeholder="250 269 8X XXX XX XXX"
          className="w-full px-2 py-1.5 rounded-lg border border-border bg-white text-xs font-mono disabled:opacity-50"
        />
        <p className="text-[10px] text-muted mt-1">15 chiffres · puce sous-cutanée</p>
      </Field>

      <Field label="Notes libres">
        <textarea
          defaultValue={animal.notes ?? ''}
          disabled={isTemp}
          onBlur={e => {
            const v = e.target.value.trim()
            if (v !== (animal.notes ?? '')) update({ notes: v || undefined })
          }}
          placeholder="Caractère, allergies, particularités…"
          rows={3}
          className="w-full px-2 py-1.5 rounded-lg border border-border bg-white text-xs resize-none disabled:opacity-50"
        />
      </Field>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="bg-card rounded-xl p-3 border border-border/40">
      <p className="text-[11px] font-bold text-muted uppercase tracking-wider mb-2">{label}</p>
      {children}
    </div>
  )
}
