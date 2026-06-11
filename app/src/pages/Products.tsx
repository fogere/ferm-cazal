// Page "Produits donnés aux animaux" — registre transversal de la ferme.
// Demande Nils 03/06/2026 (bug report W94LHlQy) : "une page pour indiquer tous les
// produits donnés aux animaux, avec qui et quand, pouvoir les ajouter / modifier /
// supprimer". Distinct du carnet de soins (animal_care, par animal) : ici une saisie
// peut concerner plusieurs animaux (ou tout le troupeau) en une seule fois.
//
// Collection Firestore : animal_products (cf. firestore.rules + types/index.ts).
// Convention projet : where() seul, tri côté client (pas d'index composite).

import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Plus, X, Pencil, Trash2, Package } from 'lucide-react'
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc } from '../services/firestoreMonitor'
import { db } from '../firebase'
import { useAuth } from '../hooks/useAuth'
import { useUsers } from '../hooks/useUsers'
import { useCustomSpecies } from '../hooks/useCustomSpecies'
import { getSpeciesInfo } from '../services/species'
import { dateInputToTs, tsToDateInput } from '../services/map/time'
import type { Animal, AnimalProduct } from '../types'

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
}

interface DraftState {
  id:          string | null   // null = création, sinon édition
  productName: string
  dose:        string
  date:        string          // input date (YYYY-MM-DD)
  givenBy:     string          // uid
  animalIds:   string[]
  note:        string
}

function blankDraft(defaultUid: string): DraftState {
  return {
    id: null, productName: '', dose: '', date: tsToDateInput(), givenBy: defaultUid,
    animalIds: [], note: '',
  }
}

export default function Products() {
  const navigate = useNavigate()
  const { user, isTemp } = useAuth()
  const users = useUsers()
  const customSpecies = useCustomSpecies()

  const [products, setProducts] = useState<AnimalProduct[]>([])
  const [animals,  setAnimals]  = useState<Animal[]>([])
  const [draft,    setDraft]    = useState<DraftState | null>(null)
  const [busy,     setBusy]     = useState(false)
  const [search,   setSearch]   = useState('')

  useEffect(() => {
    const u1 = onSnapshot(collection(db, 'animal_products'), snap =>
      setProducts(snap.docs.map(d => ({ id: d.id, ...d.data() } as AnimalProduct))))
    const u2 = onSnapshot(collection(db, 'animals'), snap =>
      setAnimals(snap.docs.map(d => ({ id: d.id, ...d.data() } as Animal))))
    return () => { u1(); u2() }
  }, [])

  const userName  = (uid: string) => users.find(u => u.uid === uid)?.displayName ?? '—'
  const userColor = (uid: string) => users.find(u => u.uid === uid)?.color ?? '#6B7280'
  const animalById = useMemo(() => {
    const m = new Map<string, Animal>()
    for (const a of animals) m.set(a.id, a)
    return m
  }, [animals])

  // Tri récent → ancien, filtré par la recherche (nom produit ou nom animal).
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = [...products].sort((a, b) => b.givenAt - a.givenAt)
    if (!q) return list
    return list.filter(p => {
      if (p.productName.toLowerCase().includes(q)) return true
      return p.animalIds.some(id => animalById.get(id)?.name?.toLowerCase().includes(q))
    })
  }, [products, search, animalById])

  function openCreate() {
    if (isTemp) return
    setDraft(blankDraft(user?.uid ?? ''))
  }
  function openEdit(p: AnimalProduct) {
    if (isTemp) return
    setDraft({
      id: p.id, productName: p.productName, dose: p.dose ?? '',
      date: tsToDateInput(p.givenAt), givenBy: p.givenBy,
      animalIds: p.animalIds ?? [], note: p.note ?? '',
    })
  }

  function toggleAnimal(id: string) {
    setDraft(d => d && ({ ...d, animalIds: d.animalIds.includes(id)
      ? d.animalIds.filter(x => x !== id)
      : [...d.animalIds, id] }))
  }

  async function save() {
    if (!draft || !user || isTemp) return
    if (!draft.productName.trim()) return
    setBusy(true)
    try {
      const now = Date.now()
      const payload = {
        productName: draft.productName.trim(),
        animalIds:   draft.animalIds,
        givenAt:     dateInputToTs(draft.date),
        givenBy:     draft.givenBy || user.uid,
        dose:        draft.dose.trim(),
        note:        draft.note.trim(),
        updatedAt:   now,
        updatedBy:   user.uid,
      }
      if (draft.id) {
        await updateDoc(doc(db, 'animal_products', draft.id), payload)
      } else {
        await addDoc(collection(db, 'animal_products'), {
          ...payload, createdAt: now, createdBy: user.uid,
        })
      }
      setDraft(null)
    } catch (err) {
      console.error('[products] save failed', err)
      alert("Erreur lors de l'enregistrement du produit. Réessaye.")
    } finally {
      setBusy(false)
    }
  }

  async function remove(p: AnimalProduct) {
    if (isTemp) return
    if (!confirm(`Supprimer « ${p.productName} » du registre ?`)) return
    setBusy(true)
    try {
      await deleteDoc(doc(db, 'animal_products', p.id))
    } catch (err) {
      console.error('[products] delete failed', err)
      alert('Erreur lors de la suppression. Réessaye.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-full bg-cream pb-12">
      {/* Header */}
      <div className="bg-card border-b border-border sticky top-0 z-10">
        <div className="flex items-center justify-between px-3 py-2">
          <button onClick={() => navigate(-1)}
                  className="p-2 rounded-xl text-charcoal active:bg-cream flex items-center gap-1 text-xs font-semibold">
            <ArrowLeft size={16} /> Retour
          </button>
          <p className="text-sm font-bold text-charcoal m-0">💊 Produits donnés</p>
          <div className="w-12" />
        </div>
        <div className="px-3 pb-3">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Rechercher un produit ou un animal…"
            className="w-full px-3 py-2 rounded-xl border border-border bg-cream text-sm text-charcoal
                       placeholder:text-muted/60 focus:outline-none focus:ring-2 focus:ring-forest"
          />
        </div>
      </div>

      {/* Liste */}
      <div className="px-3 py-4 space-y-2">
        {visible.length === 0 ? (
          <div className="bg-card rounded-2xl p-8 text-center border border-dashed border-border">
            <Package size={32} className="mx-auto text-muted/50 mb-2" />
            <p className="text-sm font-semibold text-charcoal">Aucun produit enregistré</p>
            <p className="text-xs text-muted mt-1">
              {search ? 'Aucun résultat pour cette recherche.' : 'Ajoute le premier produit donné aux animaux.'}
            </p>
          </div>
        ) : (
          visible.map(p => {
            const named = p.animalIds.map(id => animalById.get(id)).filter(Boolean) as Animal[]
            return (
              <div key={p.id} className="bg-card rounded-2xl p-3.5 border border-border">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-charcoal truncate">{p.productName}</p>
                    {p.dose && <p className="text-xs text-muted mt-0.5">Dose : {p.dose}</p>}
                  </div>
                  {!isTemp && (
                    <div className="flex gap-1 flex-shrink-0">
                      <button onClick={() => openEdit(p)} disabled={busy}
                        className="p-1.5 rounded-lg text-muted active:bg-cream disabled:opacity-40" aria-label="Modifier">
                        <Pencil size={15} />
                      </button>
                      <button onClick={() => remove(p)} disabled={busy}
                        className="p-1.5 rounded-lg text-danger active:bg-danger/10 disabled:opacity-40" aria-label="Supprimer">
                        <Trash2 size={15} />
                      </button>
                    </div>
                  )}
                </div>

                {/* Animaux concernés */}
                <div className="flex flex-wrap gap-1 mt-2">
                  {named.length === 0 ? (
                    <span className="text-[11px] font-semibold text-forest bg-forest/10 px-2 py-0.5 rounded-full">
                      🐾 Tout le troupeau
                    </span>
                  ) : named.map(a => (
                    <button key={a.id}
                      onClick={() => navigate(`/animal/${a.id}`)}
                      className="text-[11px] font-semibold text-charcoal bg-cream border border-border px-2 py-0.5 rounded-full active:bg-border/40">
                      {getSpeciesInfo(a.species, customSpecies).emoji} {a.name}
                    </button>
                  ))}
                </div>

                {p.note && <p className="text-xs text-muted mt-2 whitespace-pre-wrap">{p.note}</p>}

                {/* Quand + qui */}
                <div className="flex items-center justify-between mt-2 pt-2 border-t border-border/50">
                  <span className="text-xs text-muted">{fmtDate(p.givenAt)}</span>
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-charcoal">
                    <span className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[10px] font-bold"
                          style={{ backgroundColor: userColor(p.givenBy) }}>
                      {userName(p.givenBy).charAt(0)}
                    </span>
                    {userName(p.givenBy)}
                  </span>
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* FAB ajouter */}
      {!isTemp && (
        <button onClick={openCreate}
          className="fixed bottom-6 right-5 z-20 bg-forest text-white rounded-full shadow-xl
                     w-14 h-14 flex items-center justify-center active:scale-95 transition-transform"
          aria-label="Ajouter un produit">
          <Plus size={26} />
        </button>
      )}

      {/* Formulaire création / édition */}
      {draft && (
        <div className="fixed inset-0 z-[2500] bg-black/50 flex items-end sm:items-center justify-center p-3">
          <div className="bg-card w-full max-w-md rounded-3xl shadow-xl overflow-hidden flex flex-col max-h-[92vh]">
            <div className="px-5 pt-5 pb-3 flex items-center justify-between border-b border-border/40">
              <p className="text-sm font-bold text-charcoal">
                {draft.id ? 'Modifier le produit' : 'Nouveau produit donné'}
              </p>
              <button onClick={() => setDraft(null)}
                className="w-8 h-8 rounded-lg bg-cream flex items-center justify-center active:scale-95">
                <X size={16} className="text-muted" />
              </button>
            </div>

            <div className="px-5 py-4 space-y-4 overflow-y-auto">
              <label className="block">
                <span className="text-xs font-semibold text-charcoal block mb-1.5">Nom du produit *</span>
                <input type="text" autoFocus value={draft.productName}
                  onChange={e => setDraft(d => d && ({ ...d, productName: e.target.value }))}
                  maxLength={80}
                  placeholder="ex: Vermifuge Eqvalan, Vitamines…"
                  className="w-full px-3 py-2 rounded-xl border border-border bg-cream text-sm text-charcoal
                             focus:outline-none focus:ring-2 focus:ring-forest" />
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs font-semibold text-charcoal block mb-1.5">Dose (optionnel)</span>
                  <input type="text" value={draft.dose}
                    onChange={e => setDraft(d => d && ({ ...d, dose: e.target.value }))}
                    maxLength={40}
                    placeholder="ex: 10 ml"
                    className="w-full px-3 py-2 rounded-xl border border-border bg-cream text-sm text-charcoal
                               focus:outline-none focus:ring-2 focus:ring-forest" />
                </label>
                <label className="block">
                  <span className="text-xs font-semibold text-charcoal block mb-1.5">Date *</span>
                  <input type="date" value={draft.date}
                    onChange={e => setDraft(d => d && ({ ...d, date: e.target.value }))}
                    className="w-full px-3 py-2 rounded-xl border border-border bg-cream text-sm text-charcoal
                               focus:outline-none focus:ring-2 focus:ring-forest" />
                </label>
              </div>

              <div>
                <span className="text-xs font-semibold text-charcoal block mb-1.5">Donné par</span>
                <div className="flex flex-wrap gap-2">
                  {users.map(u => (
                    <button key={u.uid} type="button"
                      onClick={() => setDraft(d => d && ({ ...d, givenBy: u.uid }))}
                      className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-sm font-semibold transition-all ${
                        draft.givenBy === u.uid ? 'border-forest text-forest bg-forest/10' : 'border-border text-muted bg-cream'
                      }`}>
                      <span className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold"
                            style={{ backgroundColor: u.color }}>{u.displayName.charAt(0)}</span>
                      {u.displayName}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-semibold text-charcoal">Animaux concernés</span>
                  <span className="text-[11px] text-muted">
                    {draft.animalIds.length === 0 ? 'Tout le troupeau' : `${draft.animalIds.length} sélectionné(s)`}
                  </span>
                </div>
                <p className="text-[11px] text-muted/80 mb-2 leading-tight">
                  Laisse vide si le produit a été donné à tout le troupeau.
                </p>
                <div className="grid grid-cols-2 gap-1.5 max-h-48 overflow-y-auto">
                  {[...animals].sort((a, b) => a.name.localeCompare(b.name)).map(a => {
                    const on = draft.animalIds.includes(a.id)
                    return (
                      <button key={a.id} type="button"
                        onClick={() => toggleAnimal(a.id)}
                        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-xs font-semibold text-left transition-all ${
                          on ? 'border-forest text-forest bg-forest/10' : 'border-border text-muted bg-cream'
                        }`}>
                        <span>{getSpeciesInfo(a.species, customSpecies).emoji}</span>
                        <span className="truncate">{a.name}</span>
                      </button>
                    )
                  })}
                </div>
              </div>

              <label className="block">
                <span className="text-xs font-semibold text-charcoal block mb-1.5">Remarque (optionnel)</span>
                <textarea value={draft.note} rows={2}
                  onChange={e => setDraft(d => d && ({ ...d, note: e.target.value }))}
                  placeholder="Précisions…"
                  className="w-full px-3 py-2 rounded-xl border border-border bg-cream text-sm text-charcoal
                             focus:outline-none focus:ring-2 focus:ring-forest resize-none" />
              </label>
            </div>

            <div className="px-5 py-3 border-t border-border/40 flex gap-2">
              <button onClick={() => setDraft(null)} disabled={busy}
                className="px-4 py-2.5 rounded-xl border border-border text-sm font-semibold text-muted active:bg-cream disabled:opacity-40">
                Annuler
              </button>
              <button onClick={save} disabled={busy || !draft.productName.trim()}
                className="flex-1 py-2.5 rounded-xl bg-forest text-white text-sm font-bold active:scale-95
                           disabled:opacity-40 disabled:active:scale-100">
                {busy ? 'Enregistrement…' : draft.id ? 'Enregistrer' : 'Ajouter'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
