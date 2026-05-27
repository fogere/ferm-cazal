import { collection, getDocs, query, where, writeBatch, doc } from './firestoreMonitor'
import { db } from '../firebase'
import type { Task } from '../types'

/**
 * Auto-complète (ou marque comme partiellement faites) les tâches liées à
 * un élément carte (point d'eau manuel ou espace défini). Appelé quand on a
 * effectué l'action réelle sur le terrain (remplir un point d'eau, marquer
 * "tous vus" sur un espace).
 *
 * Demande Nils 25/05/2026 : évite de devoir cocher la tâche manuellement
 * après avoir agi sur le pin/espace — supprime les notifs urgentes qui
 * partent la nuit parce qu'on a oublié de cocher.
 *
 * V6 (Eugénie 27/05/2026) — refonte 2 liens indépendants :
 *   - Une tâche peut maintenant lier 1 point d'eau ET 1 espace.
 *   - On marque linkedWaterDoneAt OU linkedLandDoneAt selon le kind.
 *   - La tâche passe en completed=true uniquement si TOUS les liens
 *     présents ont leur DoneAt set (sinon c'est juste un check partiel).
 *
 * Rétrocompat anciennes tâches (linkedKind/linkedId) : on les coche
 * directement, elles n'ont qu'un seul lien par design.
 *
 * Idempotent : si aucune tâche liée n'existe ou si toutes sont déjà
 * complétées, ne fait rien (silencieux). Les tâches récurrentes sont gérées
 * par le client dans Tasks.tsx (la prochaine occurrence sera recréée au
 * prochain affichage).
 */
export async function completeLinkedTasks(
  kind: 'water_manual' | 'land_plot',
  linkedId: string,
  userUid: string,
): Promise<number> {
  // 1 query qui ramène les tâches potentiellement candidates. On regarde
  // d'abord le nouveau champ (linkedWaterId / linkedLandId). Pour la rétrocompat
  // on ajoute une 2e query sur l'ancien linkedId. Pas d'orderBy avec where
  // (convention projet : ONBOARDING piège n°2).
  const newField = kind === 'water_manual' ? 'linkedWaterId' : 'linkedLandId'
  const [newSnap, legacySnap] = await Promise.all([
    getDocs(query(collection(db, 'tasks'), where(newField, '==', linkedId))),
    getDocs(query(collection(db, 'tasks'), where('linkedId', '==', linkedId))),
  ])

  const now = Date.now()
  const batch = writeBatch(db)
  const seen = new Set<string>()
  let count = 0

  // Helper : applique la logique de complétion partielle/totale sur une tâche.
  function consider(id: string, t: Task & { id?: string }) {
    if (seen.has(id)) return
    seen.add(id)
    if (t.completed) return

    // V6 — tâche nouveau format : peut avoir 2 liens indépendants
    const hasWater = !!t.linkedWaterId
    const hasLand  = !!t.linkedLandId
    if (hasWater || hasLand) {
      // Confirme que CETTE tâche a bien un lien matching (le query newField a
      // pu ramener une tâche dont le lien water≠cur ou land≠cur dans le rare cas
      // de collision d'id pin↔land, pas censé arriver mais safe).
      const matches =
        (kind === 'water_manual' && t.linkedWaterId === linkedId) ||
        (kind === 'land_plot'    && t.linkedLandId  === linkedId)
      if (!matches) return

      const waterDone = kind === 'water_manual' ? now : (t.linkedWaterDoneAt ?? null)
      const landDone  = kind === 'land_plot'    ? now : (t.linkedLandDoneAt  ?? null)
      // Tous les liens présents sont-ils maintenant validés ?
      const allDone = (!hasWater || !!waterDone) && (!hasLand || !!landDone)

      const updates: Record<string, unknown> = {}
      if (kind === 'water_manual') updates.linkedWaterDoneAt = now
      if (kind === 'land_plot')    updates.linkedLandDoneAt  = now
      if (allDone) {
        updates.completed   = true
        updates.completedAt = now
        updates.completedBy = userUid
      }
      batch.update(doc(db, 'tasks', id), updates)
      count++
      return
    }

    // Rétrocompat anciennes tâches (un seul lien via linkedKind/linkedId)
    if (t.linkedKind === kind && t.linkedId === linkedId) {
      batch.update(doc(db, 'tasks', id), {
        completed:   true,
        completedAt: now,
        completedBy: userUid,
      })
      count++
    }
  }

  newSnap.forEach(d => consider(d.id, d.data() as Task))
  legacySnap.forEach(d => consider(d.id, d.data() as Task))

  if (count > 0) {
    try {
      await batch.commit()
    } catch (err) {
      console.warn('[completeLinkedTasks] batch failed:', err)
    }
  }
  return count
}
