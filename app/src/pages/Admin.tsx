import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Plus, X, Pencil, Check, Download,
  PawPrint, FileSpreadsheet, KeyRound, Copy, ClipboardCheck,
  Stethoscope, ChevronDown, ChevronRight, Calendar, Camera, Trash2,
} from 'lucide-react'
import { compressImage } from '../services/image'
import FirestoreMonitorPanel from '../components/admin/FirestoreMonitorPanel'
import {
  collection, onSnapshot, addDoc, updateDoc, deleteDoc,
  doc, getDoc, setDoc, getDocs, query, where, deleteField, writeBatch,
} from '../services/firestoreMonitor'
import { db } from '../firebase'
import { useAuth, formatCode } from '../hooks/useAuth'
import { useCustomSpecies } from '../hooks/useCustomSpecies'
import { getSpeciesInfo, listAllSpecies, slugifySpecies } from '../services/species'
import { dateInputToTs, tsToDateInput } from '../services/map/time'
import type { TempAccessCode, Animal, AnimalSpecies, AnimalCareEntry, AnimalCareType, AnimalGender, AnimalCondition, AnimalPhoto, CustomSpecies, Reserve } from '../types'

// Alias local pour ne pas avoir à renommer les ~30 appels existants
const todayInputValue = tsToDateInput

/* ─── Carnet de soins : config ─── */

const CARE_CFG: Record<AnimalCareType, { icon: string; label: string; color: string }> = {
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
}

// Note : les durées de gestation sont maintenant lues via getSpeciesInfo()
// (races par défaut + races custom). Voir services/species.ts.

function dateLabelFR(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })
}

function relTimeFR(ts: number): string {
  const diff = ts - Date.now()
  const absDays = Math.abs(diff) / 86_400_000
  if (absDays < 1) return diff > 0 ? "Aujourd'hui" : "Aujourd'hui"
  if (absDays < 30) {
    const d = Math.round(absDays)
    return diff > 0 ? `dans ${d} j` : `il y a ${d} j`
  }
  if (absDays < 365) {
    const m = Math.round(absDays / 30)
    return diff > 0 ? `dans ${m} mois` : `il y a ${m} mois`
  }
  const y = Math.round(absDays / 365)
  return diff > 0 ? `dans ${y} an${y > 1 ? 's' : ''}` : `il y a ${y} an${y > 1 ? 's' : ''}`
}


interface AnimalGroup {
  name: string
  count: number
}

const DEFAULT_GROUPS: AnimalGroup[] = [
  { name: 'Juments',          count: 7  },
  { name: 'Étalon',           count: 1  },
  { name: 'Hongres chevaux',  count: 2  },
  { name: 'Pouliches',        count: 3  },
  { name: 'Ânes mâles',       count: 6  },
  { name: 'Ânes femelles',    count: 17 },
  { name: 'Hongre âne',       count: 1  },
  { name: 'Tout le troupeau', count: 37 },
]

function downloadCSV(filename: string, rows: string[][]) {
  const bom = '﻿'
  const content = bom + rows
    .map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(';'))
    .join('\r\n')
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/* ─── Sous-composant éditeur groupe ─── */

function GroupEditor({ group, onSave, onCancel }: {
  group: AnimalGroup
  onSave: (g: AnimalGroup) => void
  onCancel: () => void
}) {
  const [name,  setName]  = useState(group.name)
  const [count, setCount] = useState(String(group.count))
  return (
    <>
      <input
        value={name}
        onChange={e => setName(e.target.value)}
        className="flex-1 border border-forest rounded-lg px-2 py-1 text-sm bg-cream focus:outline-none min-w-0"
        autoFocus
      />
      <input
        type="number"
        value={count}
        onChange={e => setCount(e.target.value)}
        className="w-14 border border-forest rounded-lg px-2 py-1 text-sm bg-cream focus:outline-none text-center"
        min={0}
      />
      <button
        onClick={() => onSave({ name: name.trim() || group.name, count: parseInt(count) || 0 })}
        className="text-meadow p-1"
      >
        <Check size={16} />
      </button>
      <button onClick={onCancel} className="text-muted p-1">
        <X size={14} />
      </button>
    </>
  )
}

/* ─── Page Admin ─── */

function timeUntil(ts: number): string {
  const diff = ts - Date.now()
  if (diff <= 0) return 'Expiré'
  const h = Math.floor(diff / 3_600_000)
  const m = Math.floor((diff % 3_600_000) / 60_000)
  if (h >= 24) return `${Math.floor(h / 24)}j ${h % 24}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m} min`
}

export default function Admin() {
  const navigate = useNavigate()
  const { user } = useAuth()

  /* Groupes animaux */
  const [groups,       setGroups]       = useState<AnimalGroup[]>(DEFAULT_GROUPS)
  const [editingGroup, setEditingGroup] = useState<number | null>(null)
  const [groupsLoaded, setGroupsLoaded] = useState(false)

  /* Animaux individuels */
  const [animals,         setAnimals]         = useState<Animal[]>([])
  const [addingAnimal,    setAddingAnimal]    = useState(false)
  const [newAnimalName,   setNewAnimalName]   = useState('')
  const [newAnimalSpecies, setNewAnimalSpecies] = useState<AnimalSpecies>('horse')
  const [animalSearch,    setAnimalSearch]    = useState('')
  const [animalFilter,    setAnimalFilter]    = useState<'all' | 'overdue' | 'unplaced'>('all')

  /* Races personnalisées */
  const customSpecies = useCustomSpecies()
  const allSpeciesOptions = useMemo(() => listAllSpecies(customSpecies), [customSpecies])
  const [newRaceOpen,     setNewRaceOpen]     = useState(false)
  const [newRaceName,     setNewRaceName]     = useState('')
  const [newRaceEmoji,    setNewRaceEmoji]    = useState('🐱')
  // Édition d'une race existante (bug Eugénie 21/05/2026 : faute de frappe à corriger sans tout supprimer)
  const [editingRaceId,   setEditingRaceId]   = useState<string | null>(null)
  const [editRaceName,    setEditRaceName]    = useState('')
  const [editRaceEmoji,   setEditRaceEmoji]   = useState('')
  const [newRaceGestation, setNewRaceGestation] = useState('')
  const [newRaceSaving,   setNewRaceSaving]   = useState(false)
  const [newRaceError,    setNewRaceError]    = useState<string | null>(null)

  /* Fiche détaillée animal */
  // Section actuellement développée dans le panneau d'expansion : 'care' (défaut), 'details', 'conditions', 'photos'
  const [animalTab, setAnimalTab] = useState<Record<string, 'care' | 'details' | 'conditions' | 'photos'>>({})
  // Galerie photos d'évolution
  const [animalPhotos, setAnimalPhotos] = useState<AnimalPhoto[]>([])
  const [photoUploadAnimalId, setPhotoUploadAnimalId] = useState<string | null>(null)
  const [photoGalleryViewer, setPhotoGalleryViewer] = useState<AnimalPhoto | null>(null)
  // Formulaire nouvelle condition
  const [newCondAnimalId, setNewCondAnimalId] = useState<string | null>(null)
  const [newCondLabel,    setNewCondLabel]    = useState('')
  const [newCondDesc,     setNewCondDesc]     = useState('')
  const [newCondGenetic,  setNewCondGenetic]  = useState(false)
  const [newCondContag,   setNewCondContag]   = useState(false)
  const [newCondPerm,     setNewCondPerm]     = useState(true)

  /* Carnet de soins */
  const [careEntries,      setCareEntries]      = useState<AnimalCareEntry[]>([])
  const [expandedAnimal,   setExpandedAnimal]   = useState<string | null>(null)
  const [careFormType,     setCareFormType]     = useState<AnimalCareType>('vaccine')
  const [careFormDate,     setCareFormDate]     = useState(todayInputValue())
  const [careFormNote,     setCareFormNote]     = useState('')
  const [careFormNextDue,  setCareFormNextDue]  = useState('')
  const [careSaving,       setCareSaving]       = useState(false)
  const [photoUploadingId, setPhotoUploadingId] = useState<string | null>(null)
  const [photoViewer,      setPhotoViewer]      = useState<{ url: string; name: string } | null>(null)

  /* Réserves */
  const [reserves,         setReserves]         = useState<Reserve[]>([])
  const [reserveFormOpen,  setReserveFormOpen]  = useState(false)
  const [resName,          setResName]          = useState('')
  const [resUnit,          setResUnit]          = useState('ballots')
  const [resQty,           setResQty]           = useState('')
  const [resAlert,         setResAlert]         = useState('')
  const [resSaving,        setResSaving]        = useState(false)
  const [resBusy,          setResBusy]          = useState<string | null>(null)

  /* Export */
  const [exporting, setExporting] = useState<'tasks' | 'alerts' | 'backup' | null>(null)

  /* Codes d'accès temporaires */
  const [tempCodes,      setTempCodes]      = useState<TempAccessCode[]>([])
  const [codeFormOpen,   setCodeFormOpen]   = useState(false)
  const [codeName,       setCodeName]       = useState('')
  // Bug Nils 22/05/2026 : 'custom' = date d'expiration choisie librement (stockée dans codeCustomDate).
  const [codeDuration,   setCodeDuration]   = useState<24 | 48 | 168 | 'custom'>(24)
  const [codeCustomDate, setCodeCustomDate] = useState('') // YYYY-MM-DD du <input type=date>
  const [creatingCode,   setCreatingCode]   = useState(false)
  const [lastCreated,    setLastCreated]    = useState<{ code: string; name: string } | null>(null)
  const [copiedCode,     setCopiedCode]     = useState(false)

  /* Chargement codes d'accès temporaires */
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'tempCodes'), snap => {
      const now = Date.now()
      const items = snap.docs
        .map(d => ({ id: d.id, ...d.data() } as TempAccessCode))
        .filter(c => c.expiresAt > now)
        .sort((a, b) => b.createdAt - a.createdAt)
      setTempCodes(items)
    })
    return unsub
  }, [])

  /* Chargement groupes animaux */
  useEffect(() => {
    getDoc(doc(db, 'config', 'farm')).then(snap => {
      if (snap.exists() && Array.isArray(snap.data().animalGroups)) {
        setGroups(snap.data().animalGroups as AnimalGroup[])
      }
      setGroupsLoaded(true)
    })
  }, [])

  /* Chargement animaux individuels */
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'animals'), snap => {
      const items = snap.docs.map(d => ({ id: d.id, ...d.data() } as Animal))
      items.sort((a, b) => {
        if (a.species !== b.species) return a.species.localeCompare(b.species, 'fr')
        return a.name.localeCompare(b.name, 'fr')
      })
      setAnimals(items)
    })
    return unsub
  }, [])

  /* Chargement carnet de soins (toutes les entrées) */
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'animal_care'),
      snap => {
        const items = snap.docs.map(d => ({ id: d.id, ...d.data() } as AnimalCareEntry))
        items.sort((a, b) => b.date - a.date)
        setCareEntries(items)
      },
      err => console.warn('[Admin] animal_care:', err?.code ?? err),
    )
    return unsub
  }, [])

  /* Chargement photos d'évolution */
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'animal_photos'),
      snap => {
        const items = snap.docs.map(d => ({ id: d.id, ...d.data() } as AnimalPhoto))
        items.sort((a, b) => b.takenAt - a.takenAt)
        setAnimalPhotos(items)
      },
      err => console.warn('[Admin] animal_photos:', err?.code ?? err),
    )
    return unsub
  }, [])

  // Index photos par animal pour requête O(1) dans le rendu
  const photosByAnimal = useMemo(() => {
    const m = new Map<string, AnimalPhoto[]>()
    for (const p of animalPhotos) {
      const arr = m.get(p.animalId) ?? []
      arr.push(p)
      m.set(p.animalId, arr)
    }
    return m
  }, [animalPhotos])

  /* Chargement réserves */
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'reserves'), snap => {
      const items = snap.docs.map(d => ({ id: d.id, ...d.data() } as Reserve))
      items.sort((a, b) => a.name.localeCompare(b.name, 'fr'))
      setReserves(items)
    })
    return unsub
  }, [])

  /* Actions animaux */

  async function addAnimal() {
    if (!newAnimalName.trim() || !user) return
    await addDoc(collection(db, 'animals'), {
      name:        newAnimalName.trim(),
      species:     newAnimalSpecies,
      enclosureId: null,
      addedAt:     Date.now(),
      addedBy:     user.uid,
    })
    setNewAnimalName('')
    setAddingAnimal(false)
  }

  async function removeAnimal(id: string) {
    // Supprime aussi le carnet de soins de cet animal
    const careSnap = await getDocs(query(collection(db, 'animal_care'), where('animalId', '==', id)))
    await Promise.all(careSnap.docs.map(d => deleteDoc(doc(db, 'animal_care', d.id))))
    await deleteDoc(doc(db, 'animals', id))
  }

  /* Actions carnet de soins */

  function openCareForm(animalId: string) {
    setExpandedAnimal(prev => prev === animalId ? null : animalId)
    setCareFormType('vaccine')
    setCareFormDate(todayInputValue())
    setCareFormNote('')
    setCareFormNextDue('')
  }

  async function saveCareEntry(animalId: string) {
    if (!user) return
    setCareSaving(true)
    try {
      const entry: Record<string, unknown> = {
        animalId,
        type:        careFormType,
        date:        dateInputToTs(careFormDate),
        note:        careFormNote.trim(),
        performedBy: user.uid,
        createdAt:   Date.now(),
      }
      // Auto-calcul date prévue de mise bas pour une saillie sans rappel manuel
      if (careFormType === 'breeding' && !careFormNextDue) {
        const animal = animals.find(a => a.id === animalId)
        if (animal) {
          // Durée de gestation : récupérée depuis l'espèce (par défaut ou custom).
          // Fallback 340 j si l'espèce n'a pas de durée définie (ex: race custom sans gestation).
          const gestDays = getSpeciesInfo(animal.species, customSpecies).gestationDays ?? 340
          entry.nextDueAt = dateInputToTs(careFormDate) + gestDays * 86_400_000
        }
      } else if (careFormNextDue) {
        entry.nextDueAt = dateInputToTs(careFormNextDue)
      }
      await addDoc(collection(db, 'animal_care'), entry)
      // Reset form sans fermer (pour saisie rapide multiple si besoin)
      setCareFormNote('')
      setCareFormNextDue('')
    } finally {
      setCareSaving(false)
    }
  }

  async function deleteCareEntry(id: string) {
    await deleteDoc(doc(db, 'animal_care', id))
  }

  async function uploadAnimalPhoto(animalId: string, file: File) {
    if (!user) return
    setPhotoUploadingId(animalId)
    try {
      const dataUrl = await compressImage(file, 800, 0.7) // 800px suffit pour une photo d'identité
      if (dataUrl.length > 900_000) {
        alert('Photo trop lourde après compression.')
        return
      }
      await updateDoc(doc(db, 'animals', animalId), { photoUrl: dataUrl })
    } catch (err) {
      console.error('[animal photo]', err)
      alert("Échec de l'envoi de la photo.")
    } finally {
      setPhotoUploadingId(null)
    }
  }

  async function deleteAnimalPhoto(animalId: string) {
    await updateDoc(doc(db, 'animals', animalId), { photoUrl: deleteField() })
  }

  /* Actions réserves */

  async function addReserve() {
    if (!user || !resName.trim()) return
    setResSaving(true)
    try {
      const qty   = parseFloat(resQty.replace(',', '.')) || 0
      const alert = parseFloat(resAlert.replace(',', '.')) || 0
      await addDoc(collection(db, 'reserves'), {
        name:           resName.trim(),
        unit:           resUnit.trim() || 'unités',
        currentQty:     qty,
        alertThreshold: alert,
        updatedAt:      Date.now(),
        updatedBy:      user.uid,
      })
      setResName(''); setResUnit('ballots'); setResQty(''); setResAlert('')
      setReserveFormOpen(false)
    } finally {
      setResSaving(false)
    }
  }

  async function adjustReserve(reserve: Reserve, delta: number) {
    if (!user) return
    const next = Math.max(0, (reserve.currentQty ?? 0) + delta)
    setResBusy(reserve.id)
    try {
      await updateDoc(doc(db, 'reserves', reserve.id), {
        currentQty: next,
        updatedAt:  Date.now(),
        updatedBy:  user.uid,
      })
    } finally { setResBusy(null) }
  }

  async function setReserveQuantity(reserve: Reserve, qty: number) {
    if (!user) return
    setResBusy(reserve.id)
    try {
      await updateDoc(doc(db, 'reserves', reserve.id), {
        currentQty: Math.max(0, qty),
        updatedAt:  Date.now(),
        updatedBy:  user.uid,
      })
    } finally { setResBusy(null) }
  }

  async function deleteReserve(id: string) {
    await deleteDoc(doc(db, 'reserves', id))
  }

  // Regroupe les entrées par animal
  const careByAnimal = useMemo(() => {
    const map = new Map<string, AnimalCareEntry[]>()
    for (const e of careEntries) {
      if (!map.has(e.animalId)) map.set(e.animalId, [])
      map.get(e.animalId)!.push(e)
    }
    return map
  }, [careEntries])

  // Statut soins par animal : { overdue, dueSoon }
  function getCareStatus(animalId: string): { overdue: number; dueSoon: number } {
    const entries = careByAnimal.get(animalId) ?? []
    const now = Date.now()
    const soonHorizon = now + 14 * 86_400_000 // 14 jours
    let overdue = 0, dueSoon = 0
    for (const e of entries) {
      if (e.nextDueAt) {
        if (e.nextDueAt < now)            overdue++
        else if (e.nextDueAt < soonHorizon) dueSoon++
      }
    }
    return { overdue, dueSoon }
  }

  /* Actions groupes */

  async function saveGroups(next: AnimalGroup[]) {
    setGroups(next)
    setEditingGroup(null)
    await setDoc(doc(db, 'config', 'farm'), { animalGroups: next }, { merge: true })
  }

  function updateGroup(i: number, updated: AnimalGroup) {
    const next = [...groups]
    next[i] = updated
    saveGroups(next)
  }

  /* Actions races personnalisées */

  async function addCustomRace() {
    setNewRaceError(null)
    const name = newRaceName.trim()
    const emoji = newRaceEmoji.trim()
    if (!name)  { setNewRaceError('Donne un nom à la race.'); return }
    if (!emoji) { setNewRaceError('Choisis un emoji.'); return }
    const id = slugifySpecies(name)
    if (!id) { setNewRaceError('Nom invalide.'); return }
    // Conflit avec une race existante (défaut ou custom)
    if (id === 'horse' || id === 'donkey' || customSpecies.some(c => c.id === id)) {
      setNewRaceError('Cette race existe déjà.')
      return
    }
    setNewRaceSaving(true)
    try {
      const newRace: CustomSpecies = { id, name, emoji }
      const g = Number(newRaceGestation)
      if (newRaceGestation && Number.isFinite(g) && g > 0 && g < 1000) {
        newRace.gestationDays = Math.round(g)
      }
      const next = [...customSpecies, newRace]
      await setDoc(doc(db, 'config', 'farm'), { customSpecies: next }, { merge: true })
      setNewRaceName(''); setNewRaceEmoji('🐱'); setNewRaceGestation('')
      setNewRaceOpen(false)
      setNewAnimalSpecies(id)  // pré-sélectionne la nouvelle race pour la création en cours
    } catch (e) {
      console.error('[addCustomRace]', e)
      setNewRaceError('Échec enregistrement.')
    } finally {
      setNewRaceSaving(false)
    }
  }

  function startEditRace(c: { id: string; name: string; emoji: string }) {
    setEditingRaceId(c.id)
    setEditRaceName(c.name)
    setEditRaceEmoji(c.emoji)
  }

  function cancelEditRace() {
    setEditingRaceId(null)
    setEditRaceName('')
    setEditRaceEmoji('')
  }

  async function saveEditRace() {
    if (!editingRaceId) return
    const name  = editRaceName.trim()
    const emoji = editRaceEmoji.trim()
    if (!name || !emoji) {
      alert('Nom et emoji obligatoires.')
      return
    }
    // On garde l'id fixe (sinon il faudrait migrer tous les animaux qui l'utilisent).
    const next = customSpecies.map(c =>
      c.id === editingRaceId ? { ...c, name, emoji } : c,
    )
    try {
      await setDoc(doc(db, 'config', 'farm'), { customSpecies: next }, { merge: true })
      cancelEditRace()
    } catch (e) {
      console.error('[saveEditRace]', e)
      alert("Échec de l'enregistrement. Réessaye dans un instant.")
    }
  }

  async function removeCustomRace(id: string) {
    const inUse = animals.some(a => a.species === id)
    if (inUse) {
      alert("Impossible de supprimer : des animaux utilisent encore cette race.")
      return
    }
    if (!window.confirm('Supprimer cette race ? Les races par défaut (cheval, âne) restent toujours disponibles.')) return
    const next = customSpecies.filter(c => c.id !== id)
    await setDoc(doc(db, 'config', 'farm'), { customSpecies: next }, { merge: true })
    if (newAnimalSpecies === id) setNewAnimalSpecies('horse')
  }

  /* Fiche détaillée animal : mise à jour générique partielle */
  async function updateAnimalDetails(animalId: string, patch: Partial<Animal>) {
    try {
      await updateDoc(doc(db, 'animals', animalId), patch as never)
    } catch (e) {
      console.error('[updateAnimalDetails]', e)
      alert("Échec enregistrement. Réessaye dans un instant.")
    }
  }

  async function addAnimalCondition(animalId: string) {
    const label = newCondLabel.trim()
    if (!label || !user) return
    const animal = animals.find(a => a.id === animalId)
    if (!animal) return
    const newCondition: AnimalCondition = {
      id:           `cond_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      label,
      description:  newCondDesc.trim(),
      isGenetic:    newCondGenetic,
      isContagious: newCondContag,
      permanent:    newCondPerm,
      addedAt:      Date.now(),
      addedBy:      user.uid,
    }
    const next = [...(animal.conditions ?? []), newCondition]
    await updateAnimalDetails(animalId, { conditions: next })
    setNewCondAnimalId(null)
    setNewCondLabel(''); setNewCondDesc('')
    setNewCondGenetic(false); setNewCondContag(false); setNewCondPerm(true)
  }

  async function resolveAnimalCondition(animalId: string, conditionId: string) {
    const animal = animals.find(a => a.id === animalId)
    if (!animal?.conditions) return
    const next = animal.conditions.map(c =>
      c.id === conditionId ? { ...c, resolvedAt: Date.now() } : c
    )
    await updateAnimalDetails(animalId, { conditions: next })
  }

  async function removeAnimalCondition(animalId: string, conditionId: string) {
    if (!window.confirm('Supprimer définitivement cette condition du dossier ?')) return
    const animal = animals.find(a => a.id === animalId)
    if (!animal?.conditions) return
    const next = animal.conditions.filter(c => c.id !== conditionId)
    await updateAnimalDetails(animalId, { conditions: next })
  }

  /* Photos d'évolution (collection animal_photos — séparée de la photo d'identité). */
  async function uploadAnimalEvolutionPhoto(animalId: string, file: File, note: string = '', conditionId?: string) {
    if (!user) return
    setPhotoUploadAnimalId(animalId)
    try {
      const dataUrl = await compressImage(file, 1280, 0.75)
      if (dataUrl.length > 900_000) {
        alert('Photo trop lourde après compression. Réessaye avec une photo plus petite.')
        return
      }
      const photo: Omit<AnimalPhoto, 'id'> = {
        animalId,
        uploadedBy: user.uid,
        uploadedAt: Date.now(),
        takenAt:    Date.now(),
        dataUrl,
        note:       note.trim() || undefined,
        category:   conditionId ? 'condition' : 'general',
        conditionId,
      }
      await addDoc(collection(db, 'animal_photos'), photo)
    } catch (err) {
      console.error('[uploadAnimalPhoto]', err)
      alert("Échec de l'envoi de la photo.")
    } finally {
      setPhotoUploadAnimalId(null)
    }
  }

  async function deleteAnimalPhotoEntry(photoId: string) {
    if (!window.confirm('Supprimer cette photo ?')) return
    try {
      await deleteDoc(doc(db, 'animal_photos', photoId))
      if (photoGalleryViewer?.id === photoId) setPhotoGalleryViewer(null)
    } catch (e) {
      console.error('[deleteAnimalPhoto]', e)
    }
  }

  function deleteGroup(i: number) {
    saveGroups(groups.filter((_, idx) => idx !== i))
  }

  function addGroup() {
    const next = [...groups, { name: 'Nouveau groupe', count: 0 }]
    saveGroups(next)
    setEditingGroup(next.length - 1)
  }

  /* Actions codes d'accès */

  async function createCode() {
    if (!codeName.trim() || !user) return
    // Bug Nils 22/05/2026 : si mode custom, on prend la date du picker (fin de
    // journée 23:59 pour couvrir toute la dernière journée).
    let expiresAt: number
    if (codeDuration === 'custom') {
      if (!codeCustomDate) { alert('Choisis une date de fin.'); return }
      const [y, m, d] = codeCustomDate.split('-').map(Number)
      const end = new Date(y, m - 1, d, 23, 59, 59).getTime()
      if (end <= Date.now()) { alert('La date doit être dans le futur.'); return }
      expiresAt = end
    } else {
      expiresAt = Date.now() + codeDuration * 3_600_000
    }
    setCreatingCode(true)
    try {
      const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
      const arr = new Uint8Array(12)
      crypto.getRandomValues(arr)
      const rawCode = Array.from(arr, b => chars[b % chars.length]).join('')
      await setDoc(doc(db, 'tempCodes', rawCode), {
        displayName: codeName.trim(),
        expiresAt,
        createdAt:  Date.now(),
        createdBy:  user.uid,
      })
      setLastCreated({ code: rawCode, name: codeName.trim() })
      setCodeName('')
      setCodeFormOpen(false)
      setCopiedCode(false)
    } finally {
      setCreatingCode(false)
    }
  }

  async function revokeCode(code: TempAccessCode) {
    // Nettoyage COMPLET en un seul batch :
    // 1. tempCodes/{codeId}
    // 2. tempSessions/{uid} pour toutes les sessions liées à ce code
    // 3. users/{uid} pour chaque session (profil anonyme créé à la connexion)
    const sessions = await getDocs(
      query(collection(db, 'tempSessions'), where('codeId', '==', code.id))
    )
    const batch = writeBatch(db)
    batch.delete(doc(db, 'tempCodes', code.id))
    for (const s of sessions.docs) {
      batch.delete(s.ref)                         // tempSessions/{uid}
      batch.delete(doc(db, 'users', s.id))        // users/{uid} (profil anonyme)
    }
    try {
      await batch.commit()
    } catch (err) {
      console.error('[revoke code]', err)
      alert('Erreur lors de la révocation du code.')
    }
  }

  function copyCode(raw: string) {
    navigator.clipboard.writeText(formatCode(raw)).then(() => {
      setCopiedCode(true)
      setTimeout(() => setCopiedCode(false), 2000)
    })
  }

  /* Export CSV */

  async function exportTasks() {
    setExporting('tasks')
    try {
      const since = Date.now() - 30 * 24 * 3600_000
      const snap = await getDocs(
        query(collection(db, 'tasks'), where('createdAt', '>=', since))
      )
      const rows: string[][] = [
        ['Titre', 'Zone', 'Assigné à', 'Date échéance', 'Récurrence', 'Priorité', 'Terminée', 'Terminée le', 'Créée le'],
      ]
      snap.docs.forEach(d => {
        const t = d.data()
        rows.push([
          t.title      ?? '',
          t.zone       ?? '',
          t.assignedTo ?? '',
          t.dueDate    ? new Date(t.dueDate).toLocaleDateString('fr-FR')    : '',
          t.recurrence ?? '',
          t.priority   ?? '',
          t.completed  ? 'Oui' : 'Non',
          t.completedAt ? new Date(t.completedAt).toLocaleDateString('fr-FR') : '',
          t.createdAt   ? new Date(t.createdAt).toLocaleDateString('fr-FR')   : '',
        ])
      })
      downloadCSV(`taches-ferme-${new Date().toISOString().slice(0, 10)}.csv`, rows)
    } finally {
      setExporting(null)
    }
  }

  async function exportAlerts() {
    setExporting('alerts')
    try {
      const since = Date.now() - 30 * 24 * 3600_000
      const snap = await getDocs(
        query(collection(db, 'alerts'), where('createdAt', '>=', since))
      )
      const rows: string[][] = [
        ['Message', 'Type', 'Sévérité', 'Résolue', 'Créée le', 'Résolue le'],
      ]
      snap.docs.forEach(d => {
        const a = d.data()
        rows.push([
          a.message    ?? '',
          a.type       ?? '',
          a.severity   ?? '',
          a.resolved   ? 'Oui' : 'Non',
          a.createdAt  ? new Date(a.createdAt).toLocaleDateString('fr-FR')   : '',
          a.resolvedAt ? new Date(a.resolvedAt).toLocaleDateString('fr-FR') : '',
        ])
      })
      downloadCSV(`alertes-ferme-${new Date().toISOString().slice(0, 10)}.csv`, rows)
    } finally {
      setExporting(null)
    }
  }

  async function exportBackup() {
    setExporting('backup')
    try {
      // On exporte toutes les collections "métier" — pas tempSessions ni tempCodes (sensibles)
      const collections = [
        'users', 'tasks', 'alerts', 'map_pins', 'animals',
        'animal_care', 'rainfall', 'reserves', 'enclosure_movements',
        'pin_photos',
      ]
      const backup: Record<string, Record<string, unknown>[]> = {}
      for (const col of collections) {
        try {
          const snap = await getDocs(collection(db, col))
          backup[col] = snap.docs.map(d => ({ _id: d.id, ...d.data() }))
        } catch (e) {
          backup[col] = []
          console.warn(`[backup] ${col} skipped:`, e)
        }
      }
      const payload = {
        exportedAt: new Date().toISOString(),
        farmId:     'ferme-nilslamber',
        version:    1,
        collections: backup,
      }
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href     = url
      a.download = `sauvegarde-ferme-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setExporting(null)
    }
  }

  const totalAnimals = groups.filter(g => g.name !== 'Tout le troupeau').reduce((s, g) => s + g.count, 0)

  return (
    <div className="pb-10">

      {/* Header */}
      <div className="px-5 pt-12 pb-6"
           style={{ background: 'linear-gradient(160deg, #1A4731 0%, #2D6A4F 100%)' }}>
        <button
          onClick={() => navigate('/settings')}
          className="flex items-center gap-1.5 text-meadow-light text-sm mb-4 active:opacity-70"
        >
          <ArrowLeft size={16} /> Paramètres
        </button>
        <h1 className="text-white text-2xl font-bold m-0">Administration</h1>
        <p className="text-meadow-light text-sm mt-1">Ferme Stinglhamber · Roquefixade</p>
      </div>

      <div className="px-4 space-y-4 mt-2">

        {/* ─── Groupes d'animaux ─── */}
        <div className="bg-card rounded-2xl p-4 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <PawPrint size={16} className="text-forest" />
              <p className="text-xs font-semibold text-muted uppercase tracking-wider">
                Groupes d'animaux
              </p>
            </div>
            <span className="text-xs text-muted font-semibold">
              {totalAnimals} animaux
            </span>
          </div>

          {groupsLoaded && (
            <ul className="space-y-0.5">
              {groups.map((g, i) => (
                <li key={i} className="flex items-center gap-2 py-2 border-b border-border/40 last:border-0">
                  {editingGroup === i ? (
                    <GroupEditor
                      group={g}
                      onSave={updated => updateGroup(i, updated)}
                      onCancel={() => setEditingGroup(null)}
                    />
                  ) : (
                    <>
                      <span className="flex-1 text-sm text-charcoal">{g.name}</span>
                      <span className="text-sm font-bold text-forest w-8 text-right">{g.count}</span>
                      <button
                        onClick={() => setEditingGroup(i)}
                        className="text-muted active:text-charcoal p-1 ml-1"
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        onClick={() => deleteGroup(i)}
                        className="text-danger/40 active:text-danger p-1"
                      >
                        <X size={13} />
                      </button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}

          <div className="flex items-center justify-between mt-3">
            <button
              onClick={addGroup}
              className="flex items-center gap-1.5 text-forest text-sm font-semibold active:opacity-70"
            >
              <Plus size={14} /> Ajouter un groupe
            </button>
            <button
              onClick={() => saveGroups(DEFAULT_GROUPS)}
              className="text-xs text-muted underline active:text-charcoal"
            >
              Réinitialiser
            </button>
          </div>
        </div>

        {/* ─── Animaux individuels ─── */}
        <div className="bg-card rounded-2xl p-4 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <PawPrint size={16} className="text-forest" />
              <p className="text-xs font-semibold text-muted uppercase tracking-wider">
                Animaux
              </p>
              <span className="text-xs font-bold text-forest">
                {animals.length}
              </span>
            </div>
            {!addingAnimal && (
              <button
                onClick={() => setAddingAnimal(true)}
                className="flex items-center gap-1 text-forest text-sm font-semibold active:opacity-70"
              >
                <Plus size={16} /> Ajouter
              </button>
            )}
          </div>

          {/* Badge non-placés */}
          {animals.some(a => a.enclosureId === null) && (
            <div className="mb-3 px-3 py-2 rounded-xl bg-sun/10 border border-sun/30 text-earth text-xs font-semibold">
              ⚠ {animals.filter(a => a.enclosureId === null).length} animal(aux) non placé(s) sur la carte
            </div>
          )}

          {addingAnimal && (
            <div className="bg-cream rounded-xl p-3 mb-3 space-y-3 border border-border">
              <input
                value={newAnimalName}
                onChange={e => setNewAnimalName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addAnimal()}
                placeholder="Nom de l'animal"
                autoFocus
                className="w-full border border-border rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:border-forest"
              />
              <div>
                <p className="text-[11px] font-semibold text-muted uppercase tracking-wider mb-1.5">Race</p>
                <div className="flex flex-wrap gap-2">
                  {allSpeciesOptions.map(opt => {
                    const selected = newAnimalSpecies === opt.id
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setNewAnimalSpecies(opt.id)}
                        className={`py-2 px-3 rounded-xl border text-sm font-semibold transition-all flex items-center gap-1.5 ${
                          selected
                            ? 'border-forest text-forest bg-forest/10'
                            : 'border-border text-muted bg-white'
                        }`}
                      >
                        <span>{opt.emoji}</span> {opt.label}
                      </button>
                    )
                  })}
                  <button
                    type="button"
                    onClick={() => { setNewRaceOpen(true); setNewRaceError(null) }}
                    className="py-2 px-3 rounded-xl border border-dashed border-forest text-forest text-xs font-bold
                               active:bg-forest/10 transition-colors flex items-center gap-1"
                  >
                    <Plus size={12} /> Nouvelle race
                  </button>
                </div>
              </div>

              {/* Modale création race custom */}
              {newRaceOpen && (
                <div className="bg-card border border-forest/30 rounded-xl p-3 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-bold text-forest">+ Nouvelle race</p>
                    <button onClick={() => setNewRaceOpen(false)} className="p-1 text-muted active:text-charcoal">
                      <X size={14} />
                    </button>
                  </div>
                  <div className="flex gap-2">
                    <input
                      value={newRaceEmoji}
                      onChange={e => setNewRaceEmoji(e.target.value)}
                      placeholder="🐱"
                      maxLength={4}
                      className="w-16 text-center text-2xl border border-border rounded-xl py-2 bg-white focus:outline-none focus:border-forest"
                    />
                    <input
                      value={newRaceName}
                      onChange={e => setNewRaceName(e.target.value)}
                      placeholder="Nom (ex : Chat, Mouton, Poule)"
                      className="flex-1 border border-border rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:border-forest"
                    />
                  </div>
                  <input
                    value={newRaceGestation}
                    onChange={e => setNewRaceGestation(e.target.value)}
                    placeholder="Durée gestation en jours (optionnel)"
                    inputMode="numeric"
                    className="w-full border border-border rounded-xl px-3 py-2 text-xs bg-white focus:outline-none focus:border-forest"
                  />
                  {newRaceError && (
                    <p className="text-xs text-danger font-semibold">{newRaceError}</p>
                  )}
                  <button
                    onClick={addCustomRace}
                    disabled={newRaceSaving || !newRaceName.trim() || !newRaceEmoji.trim()}
                    className="w-full py-2 bg-forest text-white rounded-xl text-sm font-bold active:opacity-80 disabled:opacity-40"
                  >
                    {newRaceSaving ? '…' : 'Enregistrer la race'}
                  </button>
                </div>
              )}

              {/* Liste des races personnalisées (édition + suppression) */}
              {customSpecies.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[10px] font-semibold text-muted/70 uppercase tracking-wider">Races perso</p>
                  {customSpecies.map(c => {
                    const isEditing = editingRaceId === c.id
                    return (
                      <div key={c.id} className="flex items-center gap-2 bg-cream/50 border border-border rounded-lg px-2.5 py-1.5">
                        {isEditing ? (
                          <>
                            <input
                              type="text"
                              value={editRaceEmoji}
                              onChange={e => setEditRaceEmoji(e.target.value)}
                              maxLength={4}
                              className="w-12 text-center px-1 py-1 rounded border border-border bg-white text-sm"
                            />
                            <input
                              type="text"
                              autoFocus
                              value={editRaceName}
                              onChange={e => setEditRaceName(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === 'Enter') saveEditRace()
                                if (e.key === 'Escape') cancelEditRace()
                              }}
                              className="flex-1 px-2 py-1 rounded border border-border bg-white text-xs"
                            />
                            <button
                              onClick={saveEditRace}
                              className="px-2 py-1 bg-forest text-white rounded text-[11px] font-bold active:opacity-80"
                            >
                              OK
                            </button>
                            <button
                              onClick={cancelEditRace}
                              className="text-muted active:text-charcoal p-1"
                              aria-label="Annuler"
                            >
                              <X size={12} />
                            </button>
                          </>
                        ) : (
                          <>
                            <span className="text-xs text-charcoal flex-1">
                              {c.emoji} {c.name}
                              {c.gestationDays && <span className="text-muted ml-1">· {c.gestationDays} j</span>}
                            </span>
                            <button
                              onClick={() => startEditRace(c)}
                              className="text-muted active:text-forest p-1"
                              aria-label={`Modifier la race ${c.name}`}
                            >
                              <Pencil size={12} />
                            </button>
                            <button
                              onClick={() => removeCustomRace(c.id)}
                              className="text-muted active:text-danger p-1"
                              aria-label={`Supprimer la race ${c.name}`}
                            >
                              <Trash2 size={12} />
                            </button>
                          </>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
              <div className="flex gap-2">
                <button
                  onClick={addAnimal}
                  disabled={!newAnimalName.trim()}
                  className="flex-1 px-3 py-2 bg-forest text-white rounded-xl text-sm font-semibold active:opacity-80 disabled:opacity-40"
                >
                  Ajouter
                </button>
                <button
                  onClick={() => { setAddingAnimal(false); setNewAnimalName('') }}
                  className="px-3 py-2 text-muted rounded-xl text-sm border border-border active:bg-cream"
                >
                  Annuler
                </button>
              </div>
            </div>
          )}

          {animals.length === 0 ? (
            <p className="text-muted text-sm py-3 text-center italic">
              Aucun animal enregistré
            </p>
          ) : (
            <>
              {/* Recherche + filtres rapides */}
              <div className="mb-3 space-y-2">
                <input
                  type="text"
                  value={animalSearch}
                  onChange={e => setAnimalSearch(e.target.value)}
                  placeholder={`Rechercher parmi ${animals.length} animaux…`}
                  className="w-full border border-border rounded-xl px-3 py-2 text-sm bg-cream focus:outline-none focus:border-forest"
                />
                <div className="flex gap-1.5">
                  {([
                    { v: 'all',      l: `Tous (${animals.length})` },
                    { v: 'overdue',  l: `Soins ⚠ (${animals.filter(a => getCareStatus(a.id).overdue > 0).length})` },
                    { v: 'unplaced', l: `Non placés (${animals.filter(a => !a.enclosureId).length})` },
                  ] as const).map(opt => (
                    <button
                      key={opt.v}
                      onClick={() => setAnimalFilter(opt.v)}
                      className={`flex-1 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                        animalFilter === opt.v
                          ? 'border-forest text-forest bg-forest/10'
                          : 'border-border text-muted bg-cream'
                      }`}
                    >
                      {opt.l}
                    </button>
                  ))}
                </div>
              </div>

            <ul className="space-y-0.5">
              {animals
                .filter(a => {
                  if (animalFilter === 'overdue'  && getCareStatus(a.id).overdue === 0) return false
                  if (animalFilter === 'unplaced' && a.enclosureId)                     return false
                  if (animalSearch.trim()) {
                    return a.name.toLowerCase().includes(animalSearch.trim().toLowerCase())
                  }
                  return true
                })
                .sort((a, b) => {
                  // 1. Soins en retard en haut, 2. Soins à venir bientôt, 3. Reste alpha
                  const sa = getCareStatus(a.id), sb = getCareStatus(b.id)
                  const wa = sa.overdue > 0 ? 0 : sa.dueSoon > 0 ? 1 : 2
                  const wb = sb.overdue > 0 ? 0 : sb.dueSoon > 0 ? 1 : 2
                  if (wa !== wb) return wa - wb
                  if (a.species !== b.species) return a.species.localeCompare(b.species, 'fr')
                  return a.name.localeCompare(b.name, 'fr')
                })
                .map(a => {
                const expanded = expandedAnimal === a.id
                const status   = getCareStatus(a.id)
                const entries  = careByAnimal.get(a.id) ?? []
                return (
                  <li key={a.id} className="border-b border-border/40 last:border-0">
                    <div className="flex items-center gap-2 py-2">
                      <button
                        onClick={() => openCareForm(a.id)}
                        className="flex-1 flex items-center gap-3 text-left active:bg-cream/40 rounded-lg py-1 -my-1 px-1 transition-colors"
                      >
                        {a.photoUrl ? (
                          <span
                            className="w-9 h-9 rounded-full overflow-hidden flex-shrink-0 bg-cream border border-border/60 cursor-zoom-in"
                            onClick={ev => { ev.stopPropagation(); setPhotoViewer({ url: a.photoUrl!, name: a.name }) }}
                          >
                            <img src={a.photoUrl} alt={a.name} className="w-full h-full object-cover" />
                          </span>
                        ) : (
                          <span className="w-9 h-9 rounded-full bg-cream border border-border/60 flex items-center justify-center text-lg flex-shrink-0">
                            {getSpeciesInfo(a.species, customSpecies).emoji}
                          </span>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-charcoal truncate">{a.name}</p>
                          <p className="text-xs text-muted flex items-center gap-2 flex-wrap">
                            <span>{a.enclosureId ? '📍 Placé' : '⚠ Non placé'}</span>
                            {entries.length > 0 && (
                              <span className="text-forest/80">· {entries.length} soin{entries.length > 1 ? 's' : ''}</span>
                            )}
                            {status.overdue > 0 && (
                              <span className="text-danger font-bold">⚠ {status.overdue} en retard</span>
                            )}
                            {status.dueSoon > 0 && status.overdue === 0 && (
                              <span className="text-sun font-semibold">⏰ {status.dueSoon} bientôt</span>
                            )}
                          </p>
                        </div>
                        {expanded ? <ChevronDown size={16} className="text-muted" /> : <ChevronRight size={16} className="text-muted" />}
                      </button>
                      <button
                        onClick={() => removeAnimal(a.id)}
                        className="text-danger/40 active:text-danger p-1"
                        title="Supprimer l'animal et son carnet"
                      >
                        <X size={14} />
                      </button>
                    </div>

                    {/* ── Panneau fiche animal (onglets) ── */}
                    {expanded && (() => {
                      const tab = animalTab[a.id] ?? 'care'
                      const setTab = (t: 'care' | 'details' | 'conditions' | 'photos') =>
                        setAnimalTab(prev => ({ ...prev, [a.id]: t }))
                      const photos = photosByAnimal.get(a.id) ?? []
                      const generalPhotos = photos.filter(p => p.category !== 'condition')
                      const conditions = a.conditions ?? []
                      const activeConditions = conditions.filter(c => !c.resolvedAt)
                      return (
                      <div className="bg-cream rounded-xl p-3 mb-2 space-y-3 border border-border/30">
                        {/* Onglets */}
                        <div className="flex gap-1 -mx-1">
                          {([
                            ['care',       '💉 Soins'],
                            ['details',    '📋 Identité'],
                            ['conditions', `🩺 Santé${activeConditions.length > 0 ? ` (${activeConditions.length})` : ''}`],
                            ['photos',     `📸 Photos${generalPhotos.length > 0 ? ` (${generalPhotos.length})` : ''}`],
                          ] as const).map(([k, label]) => (
                            <button
                              key={k}
                              onClick={() => setTab(k)}
                              className={`flex-1 py-1.5 rounded-lg text-[11px] font-bold transition-all ${
                                tab === k
                                  ? 'bg-forest text-white'
                                  : 'bg-white text-muted border border-border'
                              }`}
                            >
                              {label}
                            </button>
                          ))}
                        </div>

                        {tab === 'details' && (
                          <div className="bg-card rounded-xl p-3 space-y-3 border border-forest/20">
                            {/* Nom — bug Eugénie 21/05/2026 : pouvoir corriger une faute de frappe sans tout recréer.
                                Bug Nils 22/05/2026 : robustifié — save aussi sur Enter
                                (sinon mobile : pas de blur si on ferme le panneau directement). */}
                            <div>
                              <label className="block text-[11px] font-bold text-muted uppercase tracking-wider mb-1">Nom</label>
                              <input
                                type="text"
                                defaultValue={a.name}
                                onBlur={e => {
                                  const v = e.target.value.trim()
                                  if (v && v !== a.name) updateAnimalDetails(a.id, { name: v })
                                  else e.target.value = a.name
                                }}
                                onKeyDown={e => {
                                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                                }}
                                className="w-full px-2 py-1.5 rounded-lg border border-border bg-white text-xs"
                                placeholder="ex: Hercule"
                              />
                            </div>

                            {/* Race / emoji — bug Nils 22/05/2026 : pouvoir corriger un emoji
                                erroné (ex : âne créé comme cheval). Modifier l'espèce met à
                                jour l'emoji affiché partout (dérivé via getSpeciesInfo). */}
                            <div>
                              <label className="block text-[11px] font-bold text-muted uppercase tracking-wider mb-1">Race / emoji</label>
                              <div className="flex flex-wrap gap-1.5">
                                {allSpeciesOptions.map(opt => {
                                  const selected = a.species === opt.id
                                  return (
                                    <button
                                      key={opt.id}
                                      type="button"
                                      onClick={() => {
                                        if (a.species !== opt.id) updateAnimalDetails(a.id, { species: opt.id })
                                      }}
                                      className={`py-1.5 px-2 rounded-lg border text-[11px] font-semibold flex items-center gap-1 transition-all ${
                                        selected
                                          ? 'border-forest text-forest bg-forest/10'
                                          : 'border-border text-muted bg-white'
                                      }`}
                                    >
                                      <span>{opt.emoji}</span> {opt.label}
                                    </button>
                                  )
                                })}
                              </div>
                            </div>

                            <div>
                              <label className="block text-[11px] font-bold text-muted uppercase tracking-wider mb-1">Date de naissance</label>
                              <div className="flex gap-2 items-center">
                                <input
                                  type="date"
                                  value={a.birthDate ? todayInputValue(a.birthDate) : ''}
                                  onChange={e => updateAnimalDetails(a.id, {
                                    birthDate: e.target.value ? dateInputToTs(e.target.value) : undefined,
                                  })}
                                  className="flex-1 px-2 py-1.5 rounded-lg border border-border bg-white text-xs"
                                />
                                <label className="text-[11px] text-muted flex items-center gap-1">
                                  <input
                                    type="checkbox"
                                    checked={!!a.birthEstimated}
                                    onChange={e => updateAnimalDetails(a.id, { birthEstimated: e.target.checked })}
                                  />
                                  estimée
                                </label>
                              </div>
                              {a.birthDate && (
                                <p className="text-[10px] text-muted mt-1">
                                  Âge : {Math.floor((Date.now() - a.birthDate) / (365 * 86_400_000))} an(s)
                                  {a.birthEstimated && ' (estimé)'}
                                </p>
                              )}
                            </div>

                            <div>
                              <label className="block text-[11px] font-bold text-muted uppercase tracking-wider mb-1">Sexe</label>
                              <div className="grid grid-cols-3 gap-1">
                                {([
                                  ['male',    '♂ Mâle'],
                                  ['female',  '♀ Femelle'],
                                  ['gelding', 'Hongre'],
                                  ['mare',    'Jument'],
                                  ['unknown', '? Inconnu'],
                                ] as [AnimalGender, string][]).map(([k, label]) => (
                                  <button
                                    key={k}
                                    onClick={() => updateAnimalDetails(a.id, { gender: k })}
                                    className={`py-1.5 rounded-lg text-[11px] font-semibold border transition-all ${
                                      a.gender === k
                                        ? 'border-forest bg-forest/10 text-forest'
                                        : 'border-border bg-white text-muted'
                                    }`}
                                  >
                                    {label}
                                  </button>
                                ))}
                              </div>
                              <label className="text-[11px] text-muted flex items-center gap-1 mt-2">
                                <input
                                  type="checkbox"
                                  checked={!!a.neutered}
                                  onChange={e => updateAnimalDetails(a.id, { neutered: e.target.checked })}
                                />
                                Castré / stérilisé
                              </label>
                            </div>

                            <div>
                              <label className="block text-[11px] font-bold text-muted uppercase tracking-wider mb-1">Parents</label>
                              <div className="space-y-1.5">
                                <select
                                  value={a.sireId ?? ''}
                                  onChange={e => updateAnimalDetails(a.id, { sireId: e.target.value || undefined })}
                                  className="w-full px-2 py-1.5 rounded-lg border border-border bg-white text-xs"
                                >
                                  <option value="">Père : (inconnu)</option>
                                  {animals.filter(p => p.id !== a.id).map(p => (
                                    <option key={p.id} value={p.id}>♂ {p.name}</option>
                                  ))}
                                </select>
                                <select
                                  value={a.damId ?? ''}
                                  onChange={e => updateAnimalDetails(a.id, { damId: e.target.value || undefined })}
                                  className="w-full px-2 py-1.5 rounded-lg border border-border bg-white text-xs"
                                >
                                  <option value="">Mère : (inconnue)</option>
                                  {animals.filter(p => p.id !== a.id).map(p => (
                                    <option key={p.id} value={p.id}>♀ {p.name}</option>
                                  ))}
                                </select>
                              </div>
                            </div>

                            <div>
                              <label className="block text-[11px] font-bold text-muted uppercase tracking-wider mb-1">Notes libres</label>
                              <textarea
                                defaultValue={a.notes ?? ''}
                                onBlur={e => {
                                  const v = e.target.value.trim()
                                  if (v !== (a.notes ?? '')) updateAnimalDetails(a.id, { notes: v || undefined })
                                }}
                                placeholder="Caractère, allergies, particularités…"
                                rows={3}
                                className="w-full px-2 py-1.5 rounded-lg border border-border bg-white text-xs resize-none"
                              />
                            </div>
                          </div>
                        )}

                        {tab === 'conditions' && (
                          <div className="bg-card rounded-xl p-3 space-y-2 border border-forest/20">
                            {/* Formulaire nouvelle condition */}
                            {newCondAnimalId === a.id ? (
                              <div className="space-y-2 border border-forest/30 bg-forest/5 rounded-lg p-2.5">
                                <input
                                  value={newCondLabel}
                                  onChange={e => setNewCondLabel(e.target.value)}
                                  placeholder="Nom (ex : Boiterie chronique, Asthme)"
                                  className="w-full px-2 py-1.5 rounded-lg border border-border bg-white text-xs"
                                  autoFocus
                                />
                                <textarea
                                  value={newCondDesc}
                                  onChange={e => setNewCondDesc(e.target.value)}
                                  placeholder="Description (cause, symptômes, traitement…)"
                                  rows={2}
                                  className="w-full px-2 py-1.5 rounded-lg border border-border bg-white text-xs resize-none"
                                />
                                <div className="flex flex-wrap gap-2 text-[11px]">
                                  <label className="flex items-center gap-1 text-charcoal">
                                    <input type="checkbox" checked={newCondPerm}
                                           onChange={e => setNewCondPerm(e.target.checked)} />
                                    À vie
                                  </label>
                                  <label className="flex items-center gap-1 text-charcoal">
                                    <input type="checkbox" checked={newCondGenetic}
                                           onChange={e => setNewCondGenetic(e.target.checked)} />
                                    Génétique (héréditaire)
                                  </label>
                                  <label className="flex items-center gap-1 text-charcoal">
                                    <input type="checkbox" checked={newCondContag}
                                           onChange={e => setNewCondContag(e.target.checked)} />
                                    Contagieux entre animaux
                                  </label>
                                </div>
                                <div className="flex gap-2">
                                  <button
                                    onClick={() => addAnimalCondition(a.id)}
                                    disabled={!newCondLabel.trim()}
                                    className="flex-1 py-1.5 bg-forest text-white rounded-lg text-xs font-bold disabled:opacity-40"
                                  >
                                    Enregistrer
                                  </button>
                                  <button
                                    onClick={() => { setNewCondAnimalId(null); setNewCondLabel(''); setNewCondDesc('') }}
                                    className="px-3 py-1.5 rounded-lg border border-border text-xs text-muted"
                                  >
                                    Annuler
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <button
                                onClick={() => setNewCondAnimalId(a.id)}
                                className="w-full py-2 rounded-lg border border-dashed border-forest text-forest text-xs font-bold
                                           active:bg-forest/10 flex items-center justify-center gap-1"
                              >
                                <Plus size={12} /> Ajouter un problème de santé
                              </button>
                            )}

                            {conditions.length === 0 ? (
                              <p className="text-xs text-muted text-center italic py-3">
                                Aucun problème de santé enregistré.
                              </p>
                            ) : (
                              <ul className="space-y-1.5">
                                {conditions.map(c => {
                                  const resolved = !!c.resolvedAt
                                  // Photos liées spécifiquement à cette condition (suivi évolution).
                                  const condPhotos = photos.filter(p => p.conditionId === c.id)
                                  return (
                                    <li key={c.id}
                                        className={`bg-white rounded-lg p-2 border ${
                                          resolved ? 'border-meadow/30 opacity-70'
                                            : c.permanent ? 'border-danger/30' : 'border-sun/30'
                                        }`}>
                                      <div className="flex items-start justify-between gap-2">
                                        <div className="flex-1 min-w-0">
                                          <p className={`text-xs font-bold ${
                                            resolved ? 'text-meadow line-through'
                                              : c.permanent ? 'text-danger' : 'text-sun'
                                          }`}>
                                            {c.permanent ? '🔴' : '🟡'} {c.label}
                                            {resolved && ' ✓ résolu'}
                                          </p>
                                          {c.description && (
                                            <p className="text-[11px] text-charcoal mt-0.5 leading-snug">{c.description}</p>
                                          )}
                                          <div className="flex flex-wrap gap-1 mt-1">
                                            {c.isGenetic && (
                                              <span className="text-[9px] bg-pink-100 text-pink-700 px-1.5 py-0.5 rounded font-bold">
                                                🧬 Héréditaire
                                              </span>
                                            )}
                                            {c.isContagious && (
                                              <span className="text-[9px] bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded font-bold">
                                                ☣ Contagieux
                                              </span>
                                            )}
                                            <span className="text-[9px] text-muted">
                                              · ajouté {dateLabelFR(c.addedAt)}
                                            </span>
                                          </div>

                                          {/* Galerie de photos de suivi de CETTE condition */}
                                          {condPhotos.length > 0 && (
                                            <div className="mt-2 grid grid-cols-4 gap-1">
                                              {condPhotos.map(p => (
                                                <button
                                                  key={p.id}
                                                  onClick={() => setPhotoGalleryViewer(p)}
                                                  className="aspect-square rounded overflow-hidden bg-cream border border-border/40
                                                             active:opacity-80 transition-opacity relative"
                                                >
                                                  <img src={p.dataUrl} alt="" className="w-full h-full object-cover" />
                                                  <div className="absolute bottom-0 inset-x-0 bg-charcoal/70 text-white text-[8px] py-0.5 text-center">
                                                    {dateLabelFR(p.takenAt)}
                                                  </div>
                                                </button>
                                              ))}
                                            </div>
                                          )}

                                          {/* Bouton : ajouter une photo de suivi DE CETTE condition */}
                                          {!resolved && (
                                            <label className="mt-2 flex items-center justify-center gap-1 py-1.5 rounded-lg border border-dashed border-forest/40 text-forest text-[10px] font-bold cursor-pointer active:bg-forest/10">
                                              <Camera size={11} />
                                              {photoUploadAnimalId === a.id ? 'Envoi…' : 'Ajouter une photo de suivi de ce problème'}
                                              <input
                                                type="file"
                                                accept="image/*"
                                                className="hidden"
                                                disabled={photoUploadAnimalId === a.id}
                                                onChange={e => {
                                                  const f = e.target.files?.[0]
                                                  if (f) uploadAnimalEvolutionPhoto(a.id, f, '', c.id)
                                                  e.target.value = ''
                                                }}
                                              />
                                            </label>
                                          )}
                                        </div>
                                        <div className="flex gap-1 flex-shrink-0">
                                          {!resolved && !c.permanent && (
                                            <button
                                              onClick={() => resolveAnimalCondition(a.id, c.id)}
                                              className="text-meadow active:opacity-60 p-1"
                                              title="Marquer comme résolu"
                                            >
                                              <Check size={12} />
                                            </button>
                                          )}
                                          <button
                                            onClick={() => removeAnimalCondition(a.id, c.id)}
                                            className="text-danger/40 active:text-danger p-1"
                                          >
                                            <X size={12} />
                                          </button>
                                        </div>
                                      </div>
                                    </li>
                                  )
                                })}
                              </ul>
                            )}
                          </div>
                        )}

                        {tab === 'photos' && (
                          <div className="bg-card rounded-xl p-3 space-y-3 border border-forest/20">
                            <label className="flex items-center justify-center gap-1 w-full py-2 rounded-lg border border-dashed border-forest text-forest text-xs font-bold cursor-pointer active:bg-forest/10">
                              <Camera size={13} />
                              {photoUploadAnimalId === a.id ? 'Envoi…' : '+ Ajouter une photo de suivi'}
                              <input
                                type="file"
                                accept="image/*"
                                className="hidden"
                                disabled={photoUploadAnimalId === a.id}
                                onChange={e => {
                                  const f = e.target.files?.[0]
                                  if (f) uploadAnimalEvolutionPhoto(a.id, f)
                                  e.target.value = ''
                                }}
                              />
                            </label>
                            {generalPhotos.length === 0 ? (
                              <p className="text-xs text-muted text-center italic py-3">
                                Aucune photo de suivi pour {a.name}.
                                Ajoutez-en régulièrement pour voir l'évolution.
                              </p>
                            ) : (
                              <div className="grid grid-cols-3 gap-1.5">
                                {generalPhotos.map(p => (
                                  <button
                                    key={p.id}
                                    onClick={() => setPhotoGalleryViewer(p)}
                                    className="aspect-square rounded-lg overflow-hidden bg-cream border border-border/40
                                               active:opacity-80 transition-opacity relative"
                                  >
                                    <img src={p.dataUrl} alt="" className="w-full h-full object-cover" />
                                    <div className="absolute bottom-0 inset-x-0 bg-charcoal/70 text-white text-[9px] py-0.5 text-center">
                                      {dateLabelFR(p.takenAt)}
                                    </div>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        )}

                        {tab === 'care' && (
                        <>
                        <div className="bg-card rounded-xl p-3 space-y-2 border border-forest/20">
                          <div className="flex items-center gap-1.5 mb-1">
                            <Stethoscope size={13} className="text-forest" />
                            <p className="text-xs font-bold text-forest">Nouveau soin</p>
                          </div>
                          <div className="grid grid-cols-3 gap-1">
                            {(Object.entries(CARE_CFG) as [AnimalCareType, typeof CARE_CFG.other][]).map(([k, v]) => (
                              <button
                                key={k}
                                onClick={() => setCareFormType(k)}
                                className={`flex flex-col items-center gap-0.5 py-2 rounded-lg border text-xs font-semibold transition-all ${
                                  careFormType === k
                                    ? 'border-forest bg-forest/10 text-forest'
                                    : 'border-border bg-white text-muted'
                                }`}
                              >
                                <span className="text-base leading-none">{v.icon}</span>
                                <span className="text-[10px]">{v.label}</span>
                              </button>
                            ))}
                          </div>
                          <div className="flex gap-2 items-center">
                            <Calendar size={13} className="text-muted flex-shrink-0" />
                            <input
                              type="date"
                              value={careFormDate}
                              onChange={e => setCareFormDate(e.target.value)}
                              className="flex-1 px-2 py-1.5 rounded-lg border border-border bg-white text-xs"
                            />
                          </div>
                          <input
                            type="text"
                            value={careFormNote}
                            onChange={e => setCareFormNote(e.target.value)}
                            placeholder="Note (ex : Tétanos + grippe)"
                            className="w-full px-2 py-1.5 rounded-lg border border-border bg-white text-xs"
                          />
                          <div className="flex gap-2 items-center">
                            <span className="text-xs text-muted flex-shrink-0">Rappel:</span>
                            <input
                              type="date"
                              value={careFormNextDue}
                              onChange={e => setCareFormNextDue(e.target.value)}
                              placeholder="(facultatif)"
                              className="flex-1 px-2 py-1.5 rounded-lg border border-border bg-white text-xs"
                            />
                          </div>
                          <button
                            onClick={() => saveCareEntry(a.id)}
                            disabled={careSaving}
                            className="w-full py-2 rounded-lg bg-forest text-white text-xs font-bold
                                       active:scale-95 disabled:opacity-40 transition-all flex items-center justify-center gap-1.5"
                          >
                            <Check size={13} />
                            {careSaving ? 'Enregistrement…' : 'Enregistrer le soin'}
                          </button>
                        </div>

                        {/* Bloc photo d'identité */}
                        <div className="bg-card rounded-xl p-3 border border-border/40 flex items-center gap-3">
                          {a.photoUrl ? (
                            <>
                              <button
                                onClick={() => setPhotoViewer({ url: a.photoUrl!, name: a.name })}
                                className="w-14 h-14 rounded-xl overflow-hidden bg-cream border border-border flex-shrink-0 active:scale-95 transition-transform"
                              >
                                <img src={a.photoUrl} alt="" className="w-full h-full object-cover" />
                              </button>
                              <div className="flex-1 flex gap-2">
                                <label className="flex-1 flex items-center justify-center gap-1.5 text-xs font-bold text-forest py-2 rounded-lg bg-forest/10 active:bg-forest/20 cursor-pointer transition-colors">
                                  <Camera size={13} />
                                  {photoUploadingId === a.id ? '…' : 'Remplacer'}
                                  <input
                                    type="file"
                                    accept="image/*"
                                    capture="environment"
                                    className="hidden"
                                    disabled={photoUploadingId === a.id}
                                    onChange={async e => {
                                      const f = e.target.files?.[0]
                                      if (f) await uploadAnimalPhoto(a.id, f)
                                      e.target.value = ''
                                    }}
                                  />
                                </label>
                                <button
                                  onClick={() => deleteAnimalPhoto(a.id)}
                                  className="px-3 py-2 rounded-lg bg-danger/10 text-danger active:bg-danger/20 transition-colors"
                                  title="Retirer la photo"
                                >
                                  <Trash2 size={13} />
                                </button>
                              </div>
                            </>
                          ) : (
                            <label className="w-full flex items-center justify-center gap-1.5 text-xs font-bold text-muted py-3 rounded-lg border-2 border-dashed border-border active:bg-cream cursor-pointer transition-colors">
                              <Camera size={14} />
                              {photoUploadingId === a.id ? 'Envoi…' : "Ajouter une photo d'identité"}
                              <input
                                type="file"
                                accept="image/*"
                                capture="environment"
                                className="hidden"
                                disabled={photoUploadingId === a.id}
                                onChange={async e => {
                                  const f = e.target.files?.[0]
                                  if (f) await uploadAnimalPhoto(a.id, f)
                                  e.target.value = ''
                                }}
                              />
                            </label>
                          )}
                        </div>

                        {/* Historique */}
                        {entries.length === 0 ? (
                          <p className="text-xs text-muted italic text-center py-1">
                            Aucun soin enregistré pour {a.name}.
                          </p>
                        ) : (
                          <ul className="space-y-1.5">
                            {entries.map(e => {
                              const cfg = CARE_CFG[e.type]
                              const dueOverdue = e.nextDueAt && e.nextDueAt < Date.now()
                              return (
                                <li key={e.id} className="flex items-start gap-2 bg-white rounded-lg p-2 border border-border/40">
                                  <span className="text-base flex-shrink-0">{cfg.icon}</span>
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center justify-between gap-2">
                                      <p className={`text-xs font-bold ${cfg.color}`}>
                                        {cfg.label} <span className="text-muted font-normal">· {dateLabelFR(e.date)}</span>
                                      </p>
                                      <button
                                        onClick={() => deleteCareEntry(e.id)}
                                        className="text-danger/30 active:text-danger p-0.5 flex-shrink-0"
                                      >
                                        <X size={11} />
                                      </button>
                                    </div>
                                    {e.note && <p className="text-xs text-charcoal mt-0.5 leading-snug">{e.note}</p>}
                                    {e.nextDueAt && (
                                      <p className={`text-[11px] mt-0.5 ${dueOverdue ? 'text-danger font-semibold' : 'text-muted'}`}>
                                        ⏰ Prochain : {dateLabelFR(e.nextDueAt)} ({relTimeFR(e.nextDueAt)})
                                      </p>
                                    )}
                                  </div>
                                </li>
                              )
                            })}
                          </ul>
                        )}
                        </>
                        )}
                      </div>
                      )
                    })()}
                  </li>
                )
              })}
            </ul>
            </>
          )}

          <p className="text-xs text-muted mt-3 leading-relaxed">
            Le placement se fait sur la carte : sélectionnez une clôture fermée (enclos) pour y assigner des animaux.
          </p>
        </div>

        {/* ─── Réserves (foin, granulés, paille…) ─── */}
        <div className="bg-card rounded-2xl p-4 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="text-base">🌾</span>
              <p className="text-xs font-semibold text-muted uppercase tracking-wider">
                Réserves
                {reserves.filter(r => r.currentQty <= r.alertThreshold).length > 0 && (
                  <span className="ml-2 text-danger font-bold">
                    ⚠ {reserves.filter(r => r.currentQty <= r.alertThreshold).length} bas
                  </span>
                )}
              </p>
            </div>
            {!reserveFormOpen && (
              <button onClick={() => setReserveFormOpen(true)}
                className="flex items-center gap-1 text-forest text-sm font-semibold active:opacity-70">
                <Plus size={16} /> Ajouter
              </button>
            )}
          </div>

          {reserveFormOpen && (
            <div className="bg-cream rounded-xl p-3 mb-3 space-y-2 border border-border">
              <input
                value={resName}
                onChange={e => setResName(e.target.value)}
                placeholder="Nom (ex : Foin grange)"
                className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-forest"
                autoFocus
              />
              <div className="flex gap-2">
                <input
                  value={resUnit}
                  onChange={e => setResUnit(e.target.value)}
                  placeholder="Unité"
                  className="flex-1 border border-border rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-forest"
                />
                <input
                  type="number"
                  inputMode="decimal"
                  value={resQty}
                  onChange={e => setResQty(e.target.value)}
                  placeholder="Stock"
                  className="w-24 border border-border rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-forest"
                />
                <input
                  type="number"
                  inputMode="decimal"
                  value={resAlert}
                  onChange={e => setResAlert(e.target.value)}
                  placeholder="Alerte si ≤"
                  className="w-24 border border-border rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-forest"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={addReserve}
                  disabled={resSaving || !resName.trim()}
                  className="flex-1 py-2 rounded-lg bg-forest text-white text-sm font-bold active:scale-95 disabled:opacity-40 transition-all"
                >
                  {resSaving ? 'Création…' : 'Créer'}
                </button>
                <button
                  onClick={() => { setReserveFormOpen(false); setResName(''); setResQty(''); setResAlert('') }}
                  className="px-4 py-2 rounded-lg border border-border text-muted text-sm active:bg-cream"
                >
                  Annuler
                </button>
              </div>
            </div>
          )}

          {reserves.length === 0 ? (
            <p className="text-muted text-sm py-3 text-center italic">
              Aucune réserve enregistrée
            </p>
          ) : (
            <ul className="space-y-1.5">
              {reserves.map(r => {
                const low = r.currentQty <= r.alertThreshold
                return (
                  <li key={r.id}
                      className={`rounded-xl p-3 border flex items-center gap-3 ${low ? 'bg-danger/5 border-danger/30' : 'bg-cream border-border/40'}`}>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-charcoal truncate">{r.name}</p>
                      <p className="text-xs text-muted">
                        <span className={`font-semibold ${low ? 'text-danger' : 'text-forest'}`}>
                          {r.currentQty} {r.unit}
                        </span>
                        {' · '}seuil : {r.alertThreshold} {r.unit}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => adjustReserve(r, -1)}
                        disabled={resBusy === r.id || r.currentQty <= 0}
                        className="w-8 h-8 rounded-lg bg-white border border-border text-charcoal font-bold active:scale-95 disabled:opacity-30 transition-all"
                      >−</button>
                      <input
                        type="number"
                        inputMode="decimal"
                        defaultValue={r.currentQty}
                        key={`q-${r.id}-${r.updatedAt}`}
                        onBlur={e => {
                          const v = parseFloat(e.target.value.replace(',', '.'))
                          if (!isNaN(v) && v !== r.currentQty) setReserveQuantity(r, v)
                        }}
                        className="w-14 text-center px-1 py-1.5 rounded-lg border border-border text-sm font-semibold bg-white focus:outline-none focus:border-forest"
                      />
                      <button
                        onClick={() => adjustReserve(r, +1)}
                        disabled={resBusy === r.id}
                        className="w-8 h-8 rounded-lg bg-white border border-border text-charcoal font-bold active:scale-95 disabled:opacity-30 transition-all"
                      >+</button>
                      <button
                        onClick={() => deleteReserve(r.id)}
                        className="ml-1 p-1.5 text-danger/40 active:text-danger transition-colors"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {/* ─── Codes d'accès temporaires ─── */}
        <div className="bg-card rounded-2xl p-4 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <KeyRound size={16} className="text-forest" />
              <p className="text-xs font-semibold text-muted uppercase tracking-wider">
                Codes d'accès temporaires
              </p>
            </div>
            {!codeFormOpen && (
              <button
                onClick={() => setCodeFormOpen(true)}
                className="flex items-center gap-1 text-forest text-sm font-semibold active:opacity-70"
              >
                <Plus size={16} /> Créer
              </button>
            )}
          </div>

          {/* Formulaire création */}
          {codeFormOpen && (
            <div className="bg-cream rounded-xl p-4 mb-4 space-y-3 border border-border">
              <div>
                <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-1.5">
                  Prénom de l'aide
                </label>
                <input
                  value={codeName}
                  onChange={e => setCodeName(e.target.value)}
                  placeholder="ex: Jean"
                  autoFocus
                  className="w-full border border-border rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:border-forest"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-1.5">
                  Durée de validité
                </label>
                <div className="flex gap-2 flex-wrap">
                  {([24, 48, 168] as const).map(h => (
                    <button
                      key={h}
                      type="button"
                      onClick={() => setCodeDuration(h)}
                      className={`flex-1 min-w-[60px] py-2 rounded-xl border text-sm font-semibold transition-all ${
                        codeDuration === h
                          ? 'border-forest text-forest bg-forest/10'
                          : 'border-border text-muted bg-white'
                      }`}
                    >
                      {h === 24 ? '24 h' : h === 48 ? '48 h' : '7 jours'}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setCodeDuration('custom')}
                    className={`flex-1 min-w-[80px] py-2 rounded-xl border text-sm font-semibold transition-all ${
                      codeDuration === 'custom'
                        ? 'border-forest text-forest bg-forest/10'
                        : 'border-border text-muted bg-white'
                    }`}
                  >
                    Date custom
                  </button>
                </div>
                {/* Bug Nils 22/05/2026 : permet de choisir une date d'expiration libre.
                    L'expiration tombe à 23:59:59 du jour choisi (couvre toute la journée). */}
                {codeDuration === 'custom' && (
                  <input
                    type="date"
                    value={codeCustomDate}
                    onChange={e => setCodeCustomDate(e.target.value)}
                    min={new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)}
                    className="w-full mt-2 border border-border rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:border-forest"
                  />
                )}
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={createCode}
                  disabled={creatingCode || !codeName.trim()}
                  className="flex-1 py-2.5 bg-forest text-white rounded-xl text-sm font-semibold active:opacity-80 disabled:opacity-40"
                >
                  {creatingCode ? 'Génération…' : 'Générer le code'}
                </button>
                <button
                  onClick={() => { setCodeFormOpen(false); setCodeName('') }}
                  className="px-4 py-2.5 text-muted rounded-xl text-sm border border-border active:bg-cream"
                >
                  Annuler
                </button>
              </div>
            </div>
          )}

          {/* Code généré à partager */}
          {lastCreated && (
            <div className="bg-forest/5 border border-forest/20 rounded-xl p-4 mb-4">
              <p className="text-xs font-semibold text-forest uppercase tracking-wider mb-2">
                Code créé pour {lastCreated.name}
              </p>
              <div className="flex items-center gap-3">
                <span className="flex-1 font-mono text-xl font-bold text-charcoal tracking-widest">
                  {formatCode(lastCreated.code)}
                </span>
                <button
                  onClick={() => copyCode(lastCreated.code)}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-forest/40 text-forest text-xs font-semibold active:bg-forest/10"
                >
                  {copiedCode
                    ? <><ClipboardCheck size={14} /> Copié !</>
                    : <><Copy size={14} /> Copier</>
                  }
                </button>
              </div>
              <p className="text-xs text-muted mt-2">
                Partagez ce code à voix ou par SMS. Valide {
                  codeDuration === 168 ? '7 jours'
                  : codeDuration === 'custom' ? `jusqu'au ${codeCustomDate}`
                  : `${codeDuration}h`
                }.
              </p>
            </div>
          )}

          {/* Liste codes actifs */}
          {tempCodes.length === 0 && !codeFormOpen && !lastCreated ? (
            <p className="text-muted text-sm py-3 text-center italic">
              Aucun code actif
            </p>
          ) : tempCodes.length > 0 ? (
            <ul className="space-y-0.5">
              {tempCodes.map(c => (
                <li key={c.id} className="flex items-center gap-3 py-2.5 border-b border-border/40 last:border-0">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-charcoal">{c.displayName}</p>
                    <p className="text-xs text-muted font-mono">{formatCode(c.id)} · expire dans {timeUntil(c.expiresAt)}</p>
                  </div>
                  <button
                    onClick={() => copyCode(c.id)}
                    className="text-forest/60 active:text-forest p-1.5"
                    aria-label="Copier"
                  >
                    <Copy size={14} />
                  </button>
                  <button
                    onClick={() => revokeCode(c)}
                    className="text-danger/50 active:text-danger p-1"
                    aria-label="Révoquer"
                  >
                    <X size={15} />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          <p className="text-xs text-muted mt-3 leading-relaxed">
            Chaque code permet à une aide d'accéder à la carte et aux tâches. Aucun compte créé, aucune notification envoyée. Entropy : 32¹² combinaisons impossibles à deviner.
          </p>
        </div>

        {/* ─── Export CSV ─── */}
        <div className="bg-card rounded-2xl p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-1">
            <FileSpreadsheet size={16} className="text-forest" />
            <p className="text-xs font-semibold text-muted uppercase tracking-wider">
              Export PAC / Dossiers administratifs
            </p>
          </div>
          <p className="text-xs text-muted mb-4">
            30 derniers jours · Format CSV compatible Excel et LibreOffice
          </p>
          <div className="flex flex-col gap-3">
            <button
              onClick={exportTasks}
              disabled={exporting !== null}
              className="flex items-center justify-center gap-2 w-full py-3.5 rounded-xl border border-forest/40 text-forest text-sm font-semibold active:bg-forest/10 disabled:opacity-50 transition-colors"
            >
              <Download size={16} />
              {exporting === 'tasks' ? 'Génération en cours…' : 'Exporter les tâches (.csv)'}
            </button>
            <button
              onClick={exportAlerts}
              disabled={exporting !== null}
              className="flex items-center justify-center gap-2 w-full py-3.5 rounded-xl border border-forest/40 text-forest text-sm font-semibold active:bg-forest/10 disabled:opacity-50 transition-colors"
            >
              <Download size={16} />
              {exporting === 'alerts' ? 'Génération en cours…' : 'Exporter les alertes (.csv)'}
            </button>
            <button
              onClick={exportBackup}
              disabled={exporting !== null}
              className="flex items-center justify-center gap-2 w-full py-3.5 rounded-xl border-2 border-earth/40 bg-earth/5 text-earth text-sm font-semibold active:bg-earth/10 disabled:opacity-50 transition-colors"
            >
              <Download size={16} />
              {exporting === 'backup' ? 'Sauvegarde en cours…' : '💾 Sauvegarde complète (.json)'}
            </button>
            <p className="text-[11px] text-muted leading-relaxed -mt-1">
              La sauvegarde JSON contient toutes les données de la ferme. À garder sur ton téléphone ou dans Drive perso pour parer à un crash Firebase.
            </p>
          </div>
        </div>

        {/* ─── Monitoring Firebase (BUGV3 #4) ─── */}
        <FirestoreMonitorPanel />

      </div>

      {/* ── Viewer fullscreen photo animal ── */}
      {photoViewer && (
        <div className="fixed inset-0 z-[3000] bg-black/95 flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 text-white">
            <p className="text-sm font-semibold">{photoViewer.name}</p>
            <button
              onClick={() => setPhotoViewer(null)}
              className="p-2 rounded-xl text-white/80 active:bg-white/15"
            >
              <X size={22} />
            </button>
          </div>
          <div className="flex-1 flex items-center justify-center px-2 pb-4" onClick={() => setPhotoViewer(null)}>
            <img src={photoViewer.url} alt="" className="max-w-full max-h-full object-contain"
                 onClick={e => e.stopPropagation()} />
          </div>
        </div>
      )}

      {/* ── Viewer fullscreen pour une photo d'évolution (galerie) ── */}
      {photoGalleryViewer && (() => {
        const animal = animals.find(a => a.id === photoGalleryViewer.animalId)
        return (
          <div className="fixed inset-0 z-[3000] bg-black/95 flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 text-white">
              <div>
                <p className="text-sm font-semibold">{animal?.name ?? 'Animal'}</p>
                <p className="text-[11px] text-white/70">
                  {dateLabelFR(photoGalleryViewer.takenAt)}
                </p>
              </div>
              <div className="flex gap-1">
                <button
                  onClick={() => deleteAnimalPhotoEntry(photoGalleryViewer.id)}
                  className="p-2 rounded-xl text-white/80 active:bg-white/15"
                  title="Supprimer cette photo"
                >
                  <Trash2 size={18} />
                </button>
                <button
                  onClick={() => setPhotoGalleryViewer(null)}
                  className="p-2 rounded-xl text-white/80 active:bg-white/15"
                >
                  <X size={22} />
                </button>
              </div>
            </div>
            <div className="flex-1 flex items-center justify-center px-2 pb-4" onClick={() => setPhotoGalleryViewer(null)}>
              <img src={photoGalleryViewer.dataUrl} alt="" className="max-w-full max-h-full object-contain"
                   onClick={e => e.stopPropagation()} />
            </div>
            {photoGalleryViewer.note && (
              <div className="px-4 py-3 bg-charcoal/60 text-white/90 text-xs">
                {photoGalleryViewer.note}
              </div>
            )}
          </div>
        )
      })()}
    </div>
  )
}
