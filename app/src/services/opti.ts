import {
  doc,
  getDocs,
  getDocsFromCache,
  onSnapshot,
  setDoc,
  type Query,
  type QueryDocumentSnapshot,
  type Unsubscribe,
} from './firestoreMonitor'
import { db } from '../firebase'

/**
 * Système d'optimisation des lectures Firestore.
 *
 * ── Principe ──
 * Un document unique `/opti/state` contient un timestamp `lastUpdate` par
 * collection surveillée. Quand on écrit dans une collection, on bumpe le
 * timestamp correspondant via `bumpOpti(name)`. Quand un client veut afficher
 * la collection, il :
 *   1. Lit `/opti/state` (1 lecture, infime).
 *   2. Compare avec le dernier timestamp vu (localStorage).
 *   3. Si identique  → sert depuis le cache IndexedDB (0 lecture serveur).
 *   4. Si différent  → lit la collection depuis le serveur (N lectures).
 *   5. Continue à observer `opti` pour détecter les changements à venir.
 *
 * ── Bénéfice ──
 * Sur un appareil ouvert plusieurs fois par jour, on évite N lectures par
 * collection à chaque ouverture si rien n'a bougé. Combiné au cache
 * persistant Firestore (déjà actif), ça plafonne les lectures à quasi-zéro
 * en utilisation calme.
 *
 * ── Limite ──
 * Les changements faits par un autre utilisateur sont vus dès qu'`opti` est
 * bumpé — c'est-à-dire instantanément si `bumpOpti` est appelé après chaque
 * écriture. Le filet de secours `notify` (cron 5 min) re-synchronise opti
 * au cas où un appelant aurait oublié de bumper.
 */

const OPTI_REF = doc(db, 'opti', 'state')

const LS_KEY = (name: string) => `fm_opti_v_${name}`

/* ─── Écriture ─── */

/**
 * Met à jour le timestamp de la collection dans `opti`.
 * À appeler après chaque addDoc/updateDoc/deleteDoc sur une collection
 * surveillée. Silencieux en cas d'erreur — l'écriture principale doit
 * réussir même si opti échoue.
 */
export async function bumpOpti(collectionName: string): Promise<void> {
  try {
    await setDoc(OPTI_REF, { [collectionName]: Date.now() }, { merge: true })
  } catch {
    // Si opti échoue (quota, réseau), les autres clients verront le retard
    // à la prochaine bump réussie. Pas critique.
  }
}

/**
 * Wrapper pratique : exécute une opération Firestore puis bumpe opti.
 * Garantit que opti est toujours bumpé après une écriture réussie.
 *
 * Exemple :
 *   await writeWithOpti('map_pins', () => addDoc(collection(db, 'map_pins'), data))
 */
export async function writeWithOpti<T>(
  collectionName: string,
  op: () => Promise<T>,
): Promise<T> {
  const r = await op()
  // Fire-and-forget : ne pas bloquer la promesse de l'appelant sur le bump
  void bumpOpti(collectionName)
  return r
}

/* ─── Lecture optimisée ─── */

export interface OptimizedSnapshot<T> {
  docs: T[]
  fromCache: boolean
}

export type Parser<T> = (doc: QueryDocumentSnapshot) => T

/**
 * Souscrit aux changements d'une collection en passant par opti.
 *
 * @param collectionName  Nom de la collection (clé dans `opti`).
 * @param buildQuery      Fonction qui retourne la Query à exécuter.
 * @param parser          Convertit chaque QueryDocumentSnapshot en T.
 * @param onChange        Callback appelé à chaque changement (initial + updates).
 * @returns Unsubscribe pour nettoyer.
 *
 * Comportement :
 * - Au montage, lit opti puis :
 *   - Si la version locale == version opti  → lit le cache IndexedDB uniquement.
 *   - Sinon → lit depuis le serveur, met à jour la version locale.
 * - Reste abonné à opti. Quand opti change, re-fetch (depuis le serveur).
 */
export function optimizedSubscribe<T>(
  collectionName: string,
  buildQuery: () => Query,
  parser: Parser<T>,
  onChange: (snap: OptimizedSnapshot<T>) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  let cancelled = false
  let lastKnownVersion = 0
  try {
    const v = localStorage.getItem(LS_KEY(collectionName))
    if (v) lastKnownVersion = parseInt(v, 10) || 0
  } catch { /* ignoré */ }

  async function fetchAndEmit(useCache: boolean, knownVersion: number) {
    if (cancelled) return
    try {
      const q = buildQuery()
      const snap = useCache ? await getDocsFromCache(q) : await getDocs(q)
      if (cancelled) return
      onChange({
        docs:      snap.docs.map(parser),
        fromCache: useCache || snap.metadata.fromCache,
      })
      // Met à jour la version locale APRÈS un fetch serveur réussi.
      if (!useCache) {
        try { localStorage.setItem(LS_KEY(collectionName), String(knownVersion)) }
        catch { /* ignoré */ }
      }
    } catch (e) {
      // Cache vide ou erreur réseau : fallback
      if (useCache) {
        // Cache miss → fetch serveur en dernier recours
        await fetchAndEmit(false, knownVersion)
      } else if (onError) {
        onError(e as Error)
      }
    }
  }

  // Abonnement permanent à opti. Tout changement d'opti déclenche un refresh.
  const unsubOpti = onSnapshot(
    OPTI_REF,
    async (optiSnap) => {
      if (cancelled) return
      const data = optiSnap.data() ?? {}
      const currentVersion = Number(data[collectionName] ?? 0)

      if (currentVersion === 0) {
        // Opti pas encore initialisée pour cette collection : fetch serveur
        // et on initialisera lastKnownVersion à la valeur trouvée
        await fetchAndEmit(false, Date.now())
        lastKnownVersion = Date.now()
        return
      }

      if (currentVersion === lastKnownVersion) {
        // Pas de changement : lit le cache uniquement (0 lecture serveur)
        await fetchAndEmit(true, currentVersion)
        return
      }

      // Nouvelle version détectée
      lastKnownVersion = currentVersion
      await fetchAndEmit(false, currentVersion)
    },
    (err) => onError?.(err),
  )

  return () => {
    cancelled = true
    unsubOpti()
  }
}
