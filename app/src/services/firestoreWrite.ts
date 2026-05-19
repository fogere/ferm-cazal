import { updateDoc as fsUpdateDoc, type DocumentReference } from 'firebase/firestore'

// Quand Firestore est saturé (quota dépassé), le SDK met les écritures en file
// d'attente avec backoff exponentiel — la promesse de updateDoc() peut ne jamais
// se résoudre. Sans timeout, les boutons restent bloqués sur "Enregistrement…"
// indéfiniment.
// Note : si le timeout déclenche, la mutation reste tout de même mise en file
// dans le SDK et finira par s'appliquer quand le quota se libère. On rend juste
// l'UI à l'utilisateur sans le tromper sur l'instantanéité.
const DEFAULT_TIMEOUT_MS = 8_000

export class FirestoreWriteTimeoutError extends Error {
  constructor() {
    super("Écriture trop lente — Firestore est probablement saturé. La modification sera appliquée dès que possible.")
    this.name = 'FirestoreWriteTimeoutError'
  }
}

export function withTimeout<T>(promise: Promise<T>, ms = DEFAULT_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new FirestoreWriteTimeoutError()), ms)
    promise.then(
      v => { clearTimeout(timer); resolve(v) },
      e => { clearTimeout(timer); reject(e) },
    )
  })
}

// Drop-in replacement pour updateDoc qui ne reste pas pendu sur quota dépassé.
// On accepte un objet de mise à jour souple (clés cibles + valeurs Firestore
// classiques : valeurs primitives, FieldValue de deleteField/serverTimestamp, etc.)
// pour éviter les frictions de typage Firestore v12 avec les types génériques.
export function updateDocBounded(
  ref: DocumentReference<unknown> | DocumentReference,
  data: Record<string, unknown>,
  ms = DEFAULT_TIMEOUT_MS,
): Promise<void> {
  // Firestore v12 a un updateDoc surchargé qui accepte un objet quelconque ;
  // le cast neutre permet de garder un point d'entrée simple côté appelants.
  return withTimeout(fsUpdateDoc(ref as DocumentReference, data as never), ms)
}
