import { useMemo, useState } from 'react'
import { Plus, Check, Stethoscope, Calendar, Trash2 } from 'lucide-react'
import {
  collection, doc, addDoc, deleteDoc,
} from '../../services/firestoreMonitor'
import { db } from '../../firebase'
import { dateInputToTs, tsToDateInput } from '../../services/map/time'
import { getSpeciesInfo } from '../../services/species'
import { CARE_CFG, CARE_TYPE_ORDER } from '../../services/animal/careConfig'
import type {
  Animal, AnimalCareEntry, AnimalCareType, CustomSpecies, UserProfile,
} from '../../types'

/**
 * Carnet de soins unifié — SOURCE UNIQUE de l'UI du carnet de santé.
 *
 * Utilisé à l'identique partout où on affiche/édite le carnet d'un animal :
 *   - fiche animal (pages/AnimalDetail, ouverte depuis la carte)
 *   - administration (pages/Admin)
 *
 * Superset volontaire des deux anciennes versions (rien n'a été perdu) :
 *   - compteurs par type + bannière « rappels en retard »
 *   - formulaire : type, date, note, rappel manuel, récurrence (1 sem → 1 an)
 *   - auto-calcul de la date prévue de mise bas pour une saillie (gestation
 *     lue via getSpeciesInfo — défaut 340 j)
 *   - liste : auteur du soin, récurrence (badge ↻), rappel avec échéance
 *     relative, bouton « relancer le rappel », suppression AVEC confirmation.
 *
 * Donnée sensible : la suppression demande TOUJOURS une confirmation, et le
 * backup Firestore quotidien (scripts/backup-firestore.cjs) en garde une copie.
 */

function dateLabelFR(ts: number): string {
  return new Date(ts).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })
}

function relTimeFR(ts: number): string {
  const diff = ts - Date.now()
  const absDays = Math.abs(diff) / 86_400_000
  if (absDays < 1) return "aujourd'hui"
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

const RECUR_PRESETS: [number, string][] = [
  [0,   'Jamais'],
  [7,   '1 sem.'],
  [30,  '1 mois'],
  [90,  '3 mois'],
  [180, '6 mois'],
  [365, '1 an'],
]

interface Props {
  animal:        Animal
  careEntries:   AnimalCareEntry[]
  users:         UserProfile[]
  isTemp:        boolean
  currentUid?:   string
  customSpecies: CustomSpecies[]
}

export default function CareJournal({
  animal, careEntries, users, isTemp, currentUid, customSpecies,
}: Props) {
  const [open, setOpen]       = useState(false)
  const [type, setType]       = useState<AnimalCareType>('vaccine')
  const [date, setDate]       = useState(tsToDateInput())
  const [note, setNote]       = useState('')
  const [nextDue, setNextDue] = useState('')
  const [recur, setRecur]     = useState(0)
  const [saving, setSaving]   = useState(false)

  // Compteurs par type (pour les pastilles du haut)
  const counts = useMemo(() => {
    const c: Partial<Record<AnimalCareType, number>> = {}
    for (const e of careEntries) c[e.type] = (c[e.type] ?? 0) + 1
    return c
  }, [careEntries])

  const overdueCount = careEntries.filter(e => e.nextDueAt && e.nextDueAt < Date.now()).length

  async function save() {
    if (!currentUid || isTemp) return
    setSaving(true)
    try {
      const dateTs = dateInputToTs(date)
      // Priorité de l'échéance : rappel manuel > récurrence > gestation (saillie).
      let nextDueAt: number | undefined
      if (nextDue) {
        nextDueAt = dateInputToTs(nextDue)
      } else if (recur > 0) {
        nextDueAt = dateTs + recur * 86_400_000
      } else if (type === 'breeding') {
        const gestDays = getSpeciesInfo(animal.species, customSpecies).gestationDays ?? 340
        nextDueAt = dateTs + gestDays * 86_400_000
      }
      const entry: Omit<AnimalCareEntry, 'id'> = {
        animalId:    animal.id,
        type,
        date:        dateTs,
        note:        note.trim(),
        performedBy: currentUid,
        createdAt:   Date.now(),
        ...(nextDueAt ? { nextDueAt } : {}),
        ...(recur > 0 ? { recurrenceDays: recur } : {}),
      }
      await addDoc(collection(db, 'animal_care'), entry)
      setNote(''); setNextDue(''); setRecur(0)
      setOpen(false)
    } finally {
      setSaving(false)
    }
  }

  async function repeat(e: AnimalCareEntry) {
    if (!currentUid || !e.recurrenceDays || isTemp) return
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
    if (isTemp) return
    // Donnée sensible → confirmation obligatoire avant suppression définitive.
    if (!window.confirm('Supprimer ce soin du carnet ? Cette action est définitive.')) return
    await deleteDoc(doc(db, 'animal_care', id))
  }

  return (
    <div className="space-y-2">
      {/* Bannière rappels en retard */}
      {overdueCount > 0 && (
        <div className="bg-danger/10 border border-danger/40 rounded-lg p-2 text-[11px] text-danger font-bold flex items-center gap-1">
          ⏰ {overdueCount} rappel{overdueCount > 1 ? 's' : ''} en retard
        </div>
      )}

      {/* Compteurs par type (5 principaux) */}
      <div className="grid grid-cols-5 gap-1">
        {(['vaccine', 'vermifuge', 'parage', 'vet_visit', 'medication'] as AnimalCareType[]).map(k => (
          <div key={k} className="bg-white rounded-lg p-1.5 border border-border/40 text-center">
            <p className="text-base m-0">{CARE_CFG[k].icon}</p>
            <p className="text-[9px] text-muted m-0 leading-tight">{CARE_CFG[k].label}</p>
            <p className="text-xs font-bold text-charcoal m-0">{counts[k] ?? 0}</p>
          </div>
        ))}
      </div>

      {/* Formulaire « Nouveau soin » */}
      {!isTemp && (open ? (
        <div className="bg-cream rounded-xl p-3 space-y-2 border border-forest/20">
          <div className="flex items-center gap-1.5 mb-1">
            <Stethoscope size={13} className="text-forest" />
            <p className="text-xs font-bold text-forest">Nouveau soin</p>
          </div>
          <div className="grid grid-cols-3 gap-1">
            {CARE_TYPE_ORDER.map(k => (
              <button key={k} onClick={() => setType(k)}
                      className={`flex flex-col items-center gap-0.5 py-2 rounded-lg border text-xs font-semibold transition-all ${
                        type === k ? 'border-forest bg-forest/10 text-forest' : 'border-border bg-white text-muted'
                      }`}>
                <span className="text-base leading-none">{CARE_CFG[k].icon}</span>
                <span className="text-[10px]">{CARE_CFG[k].label}</span>
              </button>
            ))}
          </div>
          <div className="flex gap-2 items-center">
            <Calendar size={13} className="text-muted flex-shrink-0" />
            <input type="date" value={date} onChange={e => setDate(e.target.value)}
                   className="flex-1 px-2 py-1.5 rounded-lg border border-border bg-white text-xs" />
          </div>
          <input type="text" value={note} onChange={e => setNote(e.target.value)}
                 placeholder="Note (ex : Tétanos + grippe)"
                 className="w-full px-2 py-1.5 rounded-lg border border-border bg-white text-xs" />
          <div className="flex gap-2 items-center">
            <span className="text-xs text-muted flex-shrink-0">Rappel:</span>
            <input type="date" value={nextDue} onChange={e => setNextDue(e.target.value)}
                   placeholder="(facultatif)"
                   className="flex-1 px-2 py-1.5 rounded-lg border border-border bg-white text-xs" />
          </div>
          <div>
            <p className="text-[10px] font-bold text-muted uppercase tracking-wider mb-1">Récurrence</p>
            <div className="grid grid-cols-6 gap-1">
              {RECUR_PRESETS.map(([d, label]) => (
                <button key={d} onClick={() => setRecur(d)}
                        className={`py-1.5 rounded-lg text-[10px] font-semibold border transition-all ${
                          recur === d ? 'border-forest bg-forest/10 text-forest' : 'border-border bg-white text-muted'
                        }`}>
                  {label}
                </button>
              ))}
            </div>
            {type === 'breeding' && !nextDue && recur === 0 && (
              <p className="text-[10px] text-muted mt-1">
                💕 Date prévue de mise bas calculée automatiquement (gestation de l'espèce).
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={save} disabled={saving}
                    className="flex-1 py-2 rounded-lg bg-forest text-white text-xs font-bold disabled:opacity-40 flex items-center justify-center gap-1.5">
              <Check size={13} /> {saving ? 'Enregistrement…' : 'Enregistrer le soin'}
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

      {/* Historique */}
      {careEntries.length === 0 ? (
        <p className="text-xs text-muted text-center italic py-3">
          Aucun soin enregistré.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {careEntries.map(e => {
            const cfg = CARE_CFG[e.type] ?? CARE_CFG.other
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
                              className="text-danger/30 active:text-danger p-0.5 flex-shrink-0" title="Supprimer ce soin">
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
                      ⏰ Prochain : {dateLabelFR(e.nextDueAt)} ({relTimeFR(e.nextDueAt)})
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
