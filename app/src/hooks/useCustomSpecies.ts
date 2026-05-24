import { useEffect, useState } from 'react'
import { doc, onSnapshot } from '../services/firestoreMonitor'
import { db } from '../firebase'
import type { CustomSpecies } from '../types'

/**
 * Souscrit aux races personnalisées stockées dans `config/farm.customSpecies`.
 * Retourne un tableau (vide si pas encore chargé ou aucune race custom définie).
 * Mise à jour en temps réel quand un admin ajoute / supprime une race.
 */
export function useCustomSpecies(): CustomSpecies[] {
  const [list, setList] = useState<CustomSpecies[]>([])

  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, 'config', 'farm'),
      snap => {
        const data = snap.data()
        const raw  = data?.customSpecies
        setList(Array.isArray(raw) ? raw : [])
      },
      err => console.warn('[useCustomSpecies]', err?.code ?? err),
    )
    return unsub
  }, [])

  return list
}
