import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { collection, onSnapshot } from '../services/firestoreMonitor'
import { db } from '../firebase'
import { useAuth } from './useAuth'
import type { UserProfile } from '../types'

/**
 * Hook + provider pour partager UN SEUL listener Firestore `users` entre tous
 * les composants de l'app.
 *
 * Audit Firebase 25/05/2026 (Nils) : avant ce hook, `onSnapshot(collection(db,
 * 'users'))` était attaché 9× en parallèle (Tasks, Map, Dashboard, Grazing,
 * AnimalDetail, Admin, EveningRecapModal, useOnDemandLocationPublish, etc.).
 * Chaque attachement initial = 6 reads (1 par user), chaque update profile =
 * 9 callbacks. Avec un seul listener global, on divise par autant.
 *
 * Économie : à chaque ouverture d'écran consommateur, ~54 reads en moins
 * (8 écrans × 6 docs). Sur une journée typique : ~300-500 reads/utilisatrice
 * économisés.
 *
 * Le listener démarre uniquement quand un user est authentifié (rules
 * Firestore exigent l'auth pour lire users). Quand l'auth retombe, le
 * listener est démonté → 0 listener fantôme.
 *
 * Compatibilité : les composants qui avaient leur propre state `users` peuvent
 * remplacer leur useEffect+useState par un simple `const users = useUsers()`.
 * Le tableau retourné est référentiellement stable entre deux snapshots
 * inchangés (React peut donc continuer à mémoriser).
 */

const UsersContext = createContext<UserProfile[]>([])

export function UsersProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [users, setUsers] = useState<UserProfile[]>([])

  useEffect(() => {
    // Rules : seul un utilisateur authentifié peut lire `users`. On n'attache
    // pas de listener tant que l'auth n'est pas résolue.
    if (!user) {
      setUsers([])
      return
    }
    const unsub = onSnapshot(
      collection(db, 'users'),
      snap => setUsers(snap.docs.map(d => d.data() as UserProfile)),
      err => console.warn('[useUsers] snap:', err?.code),
    )
    return unsub
  }, [user])

  return <UsersContext.Provider value={users}>{children}</UsersContext.Provider>
}

export function useUsers(): UserProfile[] {
  return useContext(UsersContext)
}
