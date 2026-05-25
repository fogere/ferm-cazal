/**
 * Wrappeur d'instrumentation autour du SDK Firestore.
 *
 * Drop-in replacement de `import { ... } from 'firebase/firestore'` :
 * - réexporte toutes les fonctions "pass-through" (collection, doc, query…)
 * - intercepte les fonctions de lecture/écriture pour compter les appels
 * - expose les statistiques via `getFirestoreStats()` / `subscribeToStats()`
 *
 * Affichage : Admin > "Monitoring Firebase" (BUGV3 #4).
 *
 * Pourquoi : on est sur Firebase Spark gratuit (50k reads / 20k writes / 20k
 * deletes par jour). Avec 4 utilisatrices régulières + un fond de listeners
 * permanents, il est utile de voir en temps réel où partent les quotas et de
 * repérer les bugs de fan-out (listener qui se réinscrit en boucle, etc.).
 *
 * Toutes les valeurs sont mesurées CÔTÉ CLIENT — c'est la consommation observée
 * par ce navigateur, pas le total cross-clients du quota Firebase.
 */

// Re-exports "pass-through" (pas d'instrumentation utile sur ces helpers)
export {
  collection,
  collectionGroup,
  doc,
  query,
  where,
  orderBy,
  limit,
  limitToLast,
  startAfter,
  startAt,
  endAt,
  endBefore,
  serverTimestamp,
  deleteField,
  arrayUnion,
  arrayRemove,
  increment,
  Timestamp,
  GeoPoint,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  memoryLocalCache,
  getFirestore,
  enableIndexedDbPersistence,
  enableMultiTabIndexedDbPersistence,
  clearIndexedDbPersistence,
  disableNetwork,
  enableNetwork,
  runTransaction,
} from 'firebase/firestore'

export type {
  DocumentReference,
  CollectionReference,
  Query,
  QueryDocumentSnapshot,
  QuerySnapshot,
  DocumentSnapshot,
  DocumentData,
  Unsubscribe,
  WriteBatch,
  FirestoreError,
  FieldValue,
  Firestore,
  SnapshotOptions,
  SnapshotMetadata,
  Transaction,
} from 'firebase/firestore'

import {
  getDoc as fsGetDoc,
  getDocs as fsGetDocs,
  getDocsFromCache as fsGetDocsFromCache,
  onSnapshot as fsOnSnapshot,
  addDoc as fsAddDoc,
  setDoc as fsSetDoc,
  updateDoc as fsUpdateDoc,
  deleteDoc as fsDeleteDoc,
  writeBatch as fsWriteBatch,
  doc as fsDoc,
} from 'firebase/firestore'
import { db } from '../firebase'

// ─── Auto-bump opti ─────────────────────────────────────────────────────
//
// Audit Firebase 25/05/2026 : opti.ts permet de skip les fetchs serveur si
// rien n'a changé, mais aucun client n'appelait `bumpOpti` après ses écritures.
// On instrumente les wrappers pour le faire automatiquement sur les collections
// "froides" surveillées par le cron syncOpti (cron/notify.cjs:549).
//
// Coût : 1 write supplémentaire vers /opti/state (doc unique, merge) par
// écriture sur une collection trackée. Sur une utilisation calme (< 50 writes
// /jour/utilisatrice), impact négligeable (~ +50 writes vers opti/jour).
//
// Bénéfice : le hook geofence + tout futur usage d'optimizedSubscribe peut
// se baser sur opti pour skip les lectures inutiles. Économie attendue :
// plusieurs centaines de reads/jour/utilisatrice quand le projet est calme.
//
// Exclusions : 'users' est volontairement absent — il est updaté très souvent
// (mapOpenAt, liveLocation, livePointer) et bumper à chaque fois doublerait
// les writes vers opti. La fraîcheur du listener users reste gérée par les
// onSnapshot existants.
const OPTI_TRACKED = new Set([
  'tasks',
  'animals',
  'map_pins',
  'enclosure_movements',
  'alerts',
  'animal_care',
  'animal_photos',
  'animal_measurements',
  'reserves',
  'pin_photos',
])

function maybeBumpOpti(collectionName: string): void {
  if (collectionName === 'opti') return // jamais récursif
  if (!OPTI_TRACKED.has(collectionName)) return
  // Fire-and-forget. On utilise setDoc RAW (pas le wrapper) pour éviter de
  // re-comptabiliser ces écritures dans les stats par collection — sinon le
  // ratio cache/serveur affiché dans le panel devient incohérent.
  fsSetDoc(fsDoc(db, 'opti', 'state'),
           { [collectionName]: Date.now() },
           { merge: true })
    .catch(() => { /* silent : si opti échoue, le cron rattrapera */ })
}

// ─── Types stats ────────────────────────────────────────────────────────

export type CallKind =
  | 'read'              // getDoc, getDocs (server)
  | 'read-cache'        // getDocsFromCache (0 lecture facturée)
  | 'write'             // addDoc, setDoc, updateDoc
  | 'delete'            // deleteDoc
  | 'listener-attach'   // onSnapshot setup
  | 'listener-snapshot' // onSnapshot callback fired
  | 'listener-detach'   // unsubscribe()
  | 'batch-commit'      // writeBatch.commit()

export interface CallRecord {
  ts: number
  kind: CallKind
  path: string
  docs?: number
  durationMs?: number
  cached?: boolean // pour listener-snapshot : snap.metadata.fromCache
}

export interface CollectionStats {
  reads: number
  cacheReads: number
  writes: number
  deletes: number
  listenerEvents: number
  activeListeners: number
  docsFetched: number
  docsWritten: number
}

export interface FsStats {
  totalReads: number
  totalCacheReads: number
  totalWrites: number
  totalDeletes: number
  totalListenerEvents: number
  totalActiveListeners: number
  totalBatchCommits: number
  totalDocsFetched: number
  totalDocsWritten: number
  perCollection: Record<string, CollectionStats>
  recent: CallRecord[]
  sessionStartedAt: number
}

// ─── Store mutable + subscribers ────────────────────────────────────────

const MAX_RECENT = 250

const stats: FsStats = {
  totalReads: 0,
  totalCacheReads: 0,
  totalWrites: 0,
  totalDeletes: 0,
  totalListenerEvents: 0,
  totalActiveListeners: 0,
  totalBatchCommits: 0,
  totalDocsFetched: 0,
  totalDocsWritten: 0,
  perCollection: {},
  recent: [],
  sessionStartedAt: Date.now(),
}

const subscribers = new Set<() => void>()

let notifyScheduled = false
function scheduleNotify() {
  if (notifyScheduled) return
  notifyScheduled = true
  // Coalescent : un seul flush par microtask (sinon UI repaint à chaque appel)
  queueMicrotask(() => {
    notifyScheduled = false
    for (const fn of subscribers) {
      try { fn() } catch { /* ignored */ }
    }
  })
}

export function subscribeToStats(fn: () => void): () => void {
  subscribers.add(fn)
  return () => { subscribers.delete(fn) }
}

export function getFirestoreStats(): FsStats {
  return stats
}

export function resetFirestoreStats(): void {
  stats.totalReads = 0
  stats.totalCacheReads = 0
  stats.totalWrites = 0
  stats.totalDeletes = 0
  stats.totalListenerEvents = 0
  // On garde activeListeners (refs vivantes) — sera décompté à l'unsub réel.
  stats.totalBatchCommits = 0
  stats.totalDocsFetched = 0
  stats.totalDocsWritten = 0
  for (const c of Object.values(stats.perCollection)) {
    c.reads = 0; c.cacheReads = 0
    c.writes = 0; c.deletes = 0
    c.listenerEvents = 0
    c.docsFetched = 0; c.docsWritten = 0
    // activeListeners gardé
  }
  stats.recent = []
  stats.sessionStartedAt = Date.now()
  scheduleNotify()
}

// ─── Helpers internes ───────────────────────────────────────────────────

function ensureCollection(name: string): CollectionStats {
  let c = stats.perCollection[name]
  if (!c) {
    c = {
      reads: 0, cacheReads: 0, writes: 0, deletes: 0,
      listenerEvents: 0, activeListeners: 0,
      docsFetched: 0, docsWritten: 0,
    }
    stats.perCollection[name] = c
  }
  return c
}

function refPath(ref: unknown): string {
  if (!ref || typeof ref !== 'object') return '<unknown>'
  // DocumentReference / CollectionReference exposent `.path`
  const r = ref as { path?: string; type?: string; _query?: { path?: { canonicalString?: () => string } } }
  if (typeof r.path === 'string' && r.path.length > 0) return r.path
  // Query (firestore-lite et v9) : essaie d'extraire un chemin canonique
  const cs = r._query?.path?.canonicalString
  if (typeof cs === 'function') {
    try { return cs.call(r._query!.path) } catch { /* ignored */ }
  }
  if (r.type === 'query') return '<query>'
  if (r.type === 'collection') return '<collection>'
  if (r.type === 'document') return '<document>'
  return '<ref>'
}

function collectionFromPath(path: string): string {
  if (!path || path.startsWith('<')) return path || '<root>'
  return path.split('/')[0] || '<root>'
}

function pushRecent(rec: CallRecord) {
  stats.recent.unshift(rec)
  if (stats.recent.length > MAX_RECENT) stats.recent.length = MAX_RECENT
}

// ─── Wrappers ───────────────────────────────────────────────────────────

export const getDoc: typeof fsGetDoc = (async (ref: Parameters<typeof fsGetDoc>[0]) => {
  const path = refPath(ref)
  const col = collectionFromPath(path)
  const c = ensureCollection(col)
  const start = performance.now()
  try {
    const snap = await fsGetDoc(ref)
    stats.totalReads++
    c.reads++
    stats.totalDocsFetched++
    c.docsFetched++
    pushRecent({ ts: Date.now(), kind: 'read', path, docs: 1, durationMs: performance.now() - start })
    scheduleNotify()
    return snap
  } catch (e) {
    pushRecent({ ts: Date.now(), kind: 'read', path, docs: 0, durationMs: performance.now() - start })
    scheduleNotify()
    throw e
  }
}) as typeof fsGetDoc

export const getDocs: typeof fsGetDocs = (async (q: Parameters<typeof fsGetDocs>[0]) => {
  const path = refPath(q)
  const col = collectionFromPath(path)
  const c = ensureCollection(col)
  const start = performance.now()
  try {
    const snap = await fsGetDocs(q)
    stats.totalReads++
    c.reads++
    stats.totalDocsFetched += snap.size
    c.docsFetched += snap.size
    pushRecent({ ts: Date.now(), kind: 'read', path, docs: snap.size, durationMs: performance.now() - start })
    scheduleNotify()
    return snap
  } catch (e) {
    pushRecent({ ts: Date.now(), kind: 'read', path, docs: 0, durationMs: performance.now() - start })
    scheduleNotify()
    throw e
  }
}) as typeof fsGetDocs

export const getDocsFromCache: typeof fsGetDocsFromCache = (async (q: Parameters<typeof fsGetDocsFromCache>[0]) => {
  const path = refPath(q)
  const col = collectionFromPath(path)
  const c = ensureCollection(col)
  const snap = await fsGetDocsFromCache(q)
  stats.totalCacheReads++
  c.cacheReads++
  pushRecent({ ts: Date.now(), kind: 'read-cache', path, docs: snap.size })
  scheduleNotify()
  return snap
}) as typeof fsGetDocsFromCache

/**
 * onSnapshot wrappé.
 *
 * Pourquoi c'est tricky : la fonction Firestore est très polymorphe (overloads
 * sur signature, observer-object vs callbacks séparés, options en 2e position,
 * etc.). On wrappe au niveau d'`any` puis on caste — c'est plus sûr qu'essayer
 * de reproduire l'union de signatures.
 *
 * Les listeners qui n'ont pas été désabonnés au moment du démontage seront
 * comptabilisés comme "listener fuyant" : c'est précisément ce qu'on veut voir
 * dans le panel monitoring.
 */
export const onSnapshot: typeof fsOnSnapshot = ((refOrQuery: unknown, ...rest: unknown[]) => {
  const path = refPath(refOrQuery)
  const col = collectionFromPath(path)
  const c = ensureCollection(col)
  stats.totalActiveListeners++
  c.activeListeners++
  pushRecent({ ts: Date.now(), kind: 'listener-attach', path })
  scheduleNotify()

  // On enrobe le 1er argument de `rest` s'il est un callback ou un observer-object
  // qui a une méthode `.next`. Les autres args (options, error, complete) restent
  // intacts.
  const wrapped: unknown[] = rest.map((arg, idx) => {
    if (idx === 0 && typeof arg === 'function') {
      const fn = arg as (snap: unknown) => unknown
      return (snap: unknown) => {
        stats.totalListenerEvents++
        c.listenerEvents++
        const s = snap as { size?: number; metadata?: { fromCache?: boolean } } | null
        const n = typeof s?.size === 'number' ? s.size : 1
        const cached = !!s?.metadata?.fromCache
        pushRecent({ ts: Date.now(), kind: 'listener-snapshot', path, docs: n, cached })
        scheduleNotify()
        return fn(snap)
      }
    }
    if (idx === 0 && arg && typeof arg === 'object' && typeof (arg as { next?: unknown }).next === 'function') {
      const obs = arg as { next: (snap: unknown) => unknown }
      return {
        ...obs,
        next: (snap: unknown) => {
          stats.totalListenerEvents++
          c.listenerEvents++
          const s = snap as { size?: number; metadata?: { fromCache?: boolean } } | null
          const n = typeof s?.size === 'number' ? s.size : 1
          const cached = !!s?.metadata?.fromCache
          pushRecent({ ts: Date.now(), kind: 'listener-snapshot', path, docs: n, cached })
          scheduleNotify()
          return obs.next(snap)
        },
      }
    }
    return arg
  })

  // Cast `any` justifié : la signature publique d'onSnapshot a 6+ overloads
  // qui rendraient l'appel illisible — on délègue au runtime Firestore.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const unsub = (fsOnSnapshot as any)(refOrQuery, ...wrapped)

  return () => {
    stats.totalActiveListeners = Math.max(0, stats.totalActiveListeners - 1)
    c.activeListeners = Math.max(0, c.activeListeners - 1)
    pushRecent({ ts: Date.now(), kind: 'listener-detach', path })
    scheduleNotify()
    unsub()
  }
}) as typeof fsOnSnapshot

export const addDoc: typeof fsAddDoc = (async (ref: Parameters<typeof fsAddDoc>[0], data: Parameters<typeof fsAddDoc>[1]) => {
  const path = refPath(ref)
  const col = collectionFromPath(path)
  const c = ensureCollection(col)
  const start = performance.now()
  const r = await fsAddDoc(ref, data)
  stats.totalWrites++
  stats.totalDocsWritten++
  c.writes++
  c.docsWritten++
  pushRecent({ ts: Date.now(), kind: 'write', path, docs: 1, durationMs: performance.now() - start })
  scheduleNotify()
  maybeBumpOpti(col)
  return r
}) as typeof fsAddDoc

// setDoc : 2 ou 3 args (avec SetOptions). On wrap via spread.
export const setDoc: typeof fsSetDoc = (async (...args: unknown[]) => {
  const ref = args[0]
  const path = refPath(ref)
  const col = collectionFromPath(path)
  const c = ensureCollection(col)
  const start = performance.now()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = await (fsSetDoc as any)(...args)
  stats.totalWrites++
  stats.totalDocsWritten++
  c.writes++
  c.docsWritten++
  pushRecent({ ts: Date.now(), kind: 'write', path, docs: 1, durationMs: performance.now() - start })
  scheduleNotify()
  maybeBumpOpti(col)
  return r
}) as typeof fsSetDoc

// updateDoc : 2 args (ref, data) OU 3+ args (ref, field, value, ...) — overloads.
export const updateDoc: typeof fsUpdateDoc = (async (...args: unknown[]) => {
  const ref = args[0]
  const path = refPath(ref)
  const col = collectionFromPath(path)
  const c = ensureCollection(col)
  const start = performance.now()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = await (fsUpdateDoc as any)(...args)
  stats.totalWrites++
  stats.totalDocsWritten++
  c.writes++
  c.docsWritten++
  pushRecent({ ts: Date.now(), kind: 'write', path, docs: 1, durationMs: performance.now() - start })
  scheduleNotify()
  maybeBumpOpti(col)
  return r
}) as typeof fsUpdateDoc

export const deleteDoc: typeof fsDeleteDoc = (async (ref: Parameters<typeof fsDeleteDoc>[0]) => {
  const path = refPath(ref)
  const col = collectionFromPath(path)
  const c = ensureCollection(col)
  const start = performance.now()
  const r = await fsDeleteDoc(ref)
  stats.totalDeletes++
  c.deletes++
  pushRecent({ ts: Date.now(), kind: 'delete', path, docs: 1, durationMs: performance.now() - start })
  scheduleNotify()
  maybeBumpOpti(col)
  return r
}) as typeof fsDeleteDoc

/**
 * writeBatch wrappé.
 *
 * On intercepte les méthodes set/update/delete du batch pour compter le nombre
 * d'opérations, puis on log le commit avec docs = nombre total. C'est le seul
 * moyen de connaître la taille du batch côté client (Firestore n'expose pas
 * `.size` sur WriteBatch).
 */
export const writeBatch: typeof fsWriteBatch = ((firestore: Parameters<typeof fsWriteBatch>[0]) => {
  const batch = fsWriteBatch(firestore)
  let opCount = 0
  // Collections distinctes touchées par ce batch — pour bumper opti une seule
  // fois par collection au commit (un batch de 30 updates sur animals = 1 bump,
  // pas 30).
  const touchedCollections = new Set<string>()
  const setOriginal = batch.set.bind(batch)
  const updateOriginal = batch.update.bind(batch)
  const deleteOriginal = batch.delete.bind(batch)
  const commitOriginal = batch.commit.bind(batch)

  function trackRef(args: unknown[]) {
    const ref = args[0]
    const col = collectionFromPath(refPath(ref))
    if (col && !col.startsWith('<')) touchedCollections.add(col)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  batch.set = ((...args: unknown[]) => { opCount++; trackRef(args); return (setOriginal as any)(...args) }) as typeof batch.set
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  batch.update = ((...args: unknown[]) => { opCount++; trackRef(args); return (updateOriginal as any)(...args) }) as typeof batch.update
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  batch.delete = ((...args: unknown[]) => { opCount++; trackRef(args); return (deleteOriginal as any)(...args) }) as typeof batch.delete
  batch.commit = (async () => {
    const start = performance.now()
    const r = await commitOriginal()
    stats.totalBatchCommits++
    stats.totalDocsWritten += opCount
    pushRecent({ ts: Date.now(), kind: 'batch-commit', path: '<batch>', docs: opCount, durationMs: performance.now() - start })
    scheduleNotify()
    // Bump opti pour chaque collection touchée (déduplique par batch).
    touchedCollections.forEach(maybeBumpOpti)
    return r
  }) as typeof batch.commit

  return batch
}) as typeof fsWriteBatch
