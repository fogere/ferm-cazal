import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Plus, X, Pencil, Check, Download,
  Users, PawPrint, FileSpreadsheet, KeyRound, Copy, ClipboardCheck,
  Stethoscope, ChevronDown, ChevronRight, Calendar, Camera, Trash2,
} from 'lucide-react'
import { compressImage } from '../services/image'
import {
  collection, onSnapshot, addDoc, updateDoc, deleteDoc,
  doc, getDoc, setDoc, getDocs, query, where, deleteField, writeBatch,
} from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth, formatCode } from '../hooks/useAuth'
import type { TempUser, TempAccessCode, Animal, AnimalSpecies, AnimalCareEntry, AnimalCareType, Reserve } from '../types'

/* ─── Carnet de soins : config ─── */

const CARE_CFG: Record<AnimalCareType, { icon: string; label: string; color: string }> = {
  vaccine:    { icon: '💉', label: 'Vaccin',     color: 'text-sky' },
  vermifuge:  { icon: '💊', label: 'Vermifuge',  color: 'text-meadow' },
  parage:     { icon: '🐴', label: 'Parage',     color: 'text-earth' },
  vet_visit:  { icon: '🩺', label: 'Visite véto', color: 'text-forest' },
  medication: { icon: '🧪', label: 'Soin',       color: 'text-orange-600' },
  breeding:   { icon: '💕', label: 'Saillie',    color: 'text-pink-600' },
  birth:      { icon: '🐣', label: 'Mise bas',   color: 'text-meadow' },
  other:      { icon: '📝', label: 'Autre',      color: 'text-muted' },
}

// Durée de gestation par espèce (en jours)
const GESTATION_DAYS: Record<AnimalSpecies, number> = {
  horse:  340,
  donkey: 365,
}

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

function todayInputValue(ts: number = Date.now()): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function dateInputToTs(s: string): number {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d, 12, 0, 0).getTime()
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

  /* Utilisateurs temporaires */
  const [tempUsers,   setTempUsers]   = useState<TempUser[]>([])
  const [newName,     setNewName]     = useState('')
  const [addingUser,  setAddingUser]  = useState(false)

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
  const [codeDuration,   setCodeDuration]   = useState<24 | 48 | 168>(24)
  const [creatingCode,   setCreatingCode]   = useState(false)
  const [lastCreated,    setLastCreated]    = useState<{ code: string; name: string } | null>(null)
  const [copiedCode,     setCopiedCode]     = useState(false)

  /* Chargement tempUsers */
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'tempUsers'), snap => {
      const items = snap.docs.map(d => ({ id: d.id, ...d.data() } as TempUser))
      items.sort((a, b) => a.displayName.localeCompare(b.displayName, 'fr'))
      setTempUsers(items)
    })
    return unsub
  }, [])

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
        if (a.species !== b.species) return a.species === 'horse' ? -1 : 1
        return a.name.localeCompare(b.name, 'fr')
      })
      setAnimals(items)
    })
    return unsub
  }, [])

  /* Chargement carnet de soins (toutes les entrées) */
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'animal_care'), snap => {
      const items = snap.docs.map(d => ({ id: d.id, ...d.data() } as AnimalCareEntry))
      items.sort((a, b) => b.date - a.date)
      setCareEntries(items)
    })
    return unsub
  }, [])

  /* Chargement réserves */
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'reserves'), snap => {
      const items = snap.docs.map(d => ({ id: d.id, ...d.data() } as Reserve))
      items.sort((a, b) => a.name.localeCompare(b.name, 'fr'))
      setReserves(items)
    })
    return unsub
  }, [])

  /* Actions tempUsers */

  async function addTempUser() {
    if (!newName.trim() || !user) return
    await addDoc(collection(db, 'tempUsers'), {
      displayName: newName.trim(),
      active:      true,
      addedBy:     user.uid,
      addedAt:     Date.now(),
    })
    setNewName('')
    setAddingUser(false)
  }

  async function toggleActive(tu: TempUser) {
    await updateDoc(doc(db, 'tempUsers', tu.id), { active: !tu.active })
  }

  async function removeTempUser(id: string) {
    await deleteDoc(doc(db, 'tempUsers', id))
  }

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
          const gestDays = GESTATION_DAYS[animal.species]
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
    setCreatingCode(true)
    try {
      const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
      const arr = new Uint8Array(12)
      crypto.getRandomValues(arr)
      const rawCode = Array.from(arr, b => chars[b % chars.length]).join('')
      const expiresAt = Date.now() + codeDuration * 3_600_000
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
        'pin_photos', 'tempUsers',
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

        {/* ─── Utilisateurs temporaires ─── */}
        <div className="bg-card rounded-2xl p-4 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Users size={16} className="text-forest" />
              <p className="text-xs font-semibold text-muted uppercase tracking-wider">
                Aide occasionnelle
              </p>
            </div>
            {!addingUser && (
              <button
                onClick={() => setAddingUser(true)}
                className="flex items-center gap-1 text-forest text-sm font-semibold active:opacity-70"
              >
                <Plus size={16} /> Ajouter
              </button>
            )}
          </div>

          {addingUser && (
            <div className="flex gap-2 mb-3">
              <input
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addTempUser()}
                placeholder="Prénom"
                autoFocus
                className="flex-1 border border-border rounded-xl px-3 py-2 text-sm bg-cream focus:outline-none focus:border-forest"
              />
              <button
                onClick={addTempUser}
                className="px-3 py-2 bg-forest text-white rounded-xl text-sm font-semibold active:opacity-80"
              >
                OK
              </button>
              <button
                onClick={() => { setAddingUser(false); setNewName('') }}
                className="px-3 py-2 text-muted rounded-xl text-sm border border-border active:bg-cream"
              >
                ✕
              </button>
            </div>
          )}

          {tempUsers.length === 0 ? (
            <p className="text-muted text-sm py-3 text-center italic">
              Aucune aide occasionnelle enregistrée
            </p>
          ) : (
            <ul className="space-y-0.5">
              {tempUsers.map(tu => (
                <li key={tu.id} className="flex items-center gap-3 py-2.5 border-b border-border/40 last:border-0">
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${tu.active ? 'bg-meadow' : 'bg-border'}`} />
                  <span className={`flex-1 text-sm font-medium ${tu.active ? 'text-charcoal' : 'text-muted line-through'}`}>
                    {tu.displayName}
                  </span>
                  <button
                    onClick={() => toggleActive(tu)}
                    className={`text-xs px-2.5 py-1 rounded-lg font-semibold transition-colors ${
                      tu.active
                        ? 'bg-sun/15 text-earth active:bg-sun/30'
                        : 'bg-meadow/15 text-meadow active:bg-meadow/30'
                    }`}
                  >
                    {tu.active ? 'Désactiver' : 'Réactiver'}
                  </button>
                  <button
                    onClick={() => removeTempUser(tu.id)}
                    className="text-danger/50 active:text-danger p-1"
                  >
                    <X size={15} />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <p className="text-xs text-muted mt-3 leading-relaxed">
            Les personnes ajoutées ici apparaissent dans l'assignation des tâches mais ne reçoivent pas de notifications.
          </p>
        </div>

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
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setNewAnimalSpecies('horse')}
                  className={`flex-1 py-2 rounded-xl border text-sm font-semibold transition-all ${
                    newAnimalSpecies === 'horse'
                      ? 'border-forest text-forest bg-forest/10'
                      : 'border-border text-muted bg-white'
                  }`}
                >
                  🐎 Cheval
                </button>
                <button
                  type="button"
                  onClick={() => setNewAnimalSpecies('donkey')}
                  className={`flex-1 py-2 rounded-xl border text-sm font-semibold transition-all ${
                    newAnimalSpecies === 'donkey'
                      ? 'border-earth text-earth bg-earth/10'
                      : 'border-border text-muted bg-white'
                  }`}
                >
                  🐴 Âne
                </button>
              </div>
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
                  if (a.species !== b.species) return a.species === 'horse' ? -1 : 1
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
                            {a.species === 'horse' ? '🐎' : '🐴'}
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

                    {/* ── Panneau carnet de soins ── */}
                    {expanded && (
                      <div className="bg-cream rounded-xl p-3 mb-2 space-y-3 border border-border/30">
                        {/* Formulaire ajout */}
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
                      </div>
                    )}
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
                <div className="flex gap-2">
                  {([24, 48, 168] as const).map(h => (
                    <button
                      key={h}
                      type="button"
                      onClick={() => setCodeDuration(h)}
                      className={`flex-1 py-2 rounded-xl border text-sm font-semibold transition-all ${
                        codeDuration === h
                          ? 'border-forest text-forest bg-forest/10'
                          : 'border-border text-muted bg-white'
                      }`}
                    >
                      {h === 24 ? '24 h' : h === 48 ? '48 h' : '7 jours'}
                    </button>
                  ))}
                </div>
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
                Partagez ce code à voix ou par SMS. Valide {codeDuration === 168 ? '7 jours' : `${codeDuration}h`}.
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
    </div>
  )
}
