import { collection, getDocs, query, where, writeBatch, doc } from './firestoreMonitor'
import { db } from '../firebase'

/**
 * Auto-complète toutes les tâches non terminées liées à un élément carte
 * (point d'eau manuel ou espace défini). Appelé quand on a effectué l'action
 * réelle sur le terrain (remplir un point d'eau, marquer "tous vus" sur un espace).
 *
 * Demande Nils 25/05/2026 : évite de devoir cocher la tâche manuellement après
 * avoir agi sur le pin/espace — supprime les notifs urgentes qui partent la nuit
 * parce qu'on a oublié de cocher.
 *
 * Idempotent : si aucune tâche liée n'existe ou si toutes sont déjà complétées,
 * ne fait rien (silencieux). Les tâches récurrentes sont gérées par le client
 * dans Tasks.tsx (la prochaine occurrence sera recréée au prochain affichage).
 *
 * On n'utilise PAS nextOccurrenceCreated ici (rattrapé par le cron) — préfère
 * faire simple : juste marquer completed, le filet cron rattrapera la récurrence.
 */
export async function completeLinkedTasks(
  kind: 'water_manual' | 'land_plot',
  linkedId: string,
  userUid: string,
): Promise<number> {
  // Pas d'orderBy avec where(linkedId) — convention projet (cf. ONBOARDING piège n°2).
  const q = query(collection(db, 'tasks'), where('linkedId', '==', linkedId))
  const snap = await getDocs(q)
  const now = Date.now()
  const batch = writeBatch(db)
  let count = 0
  snap.forEach(d => {
    const t = d.data() as { linkedKind?: string; completed?: boolean }
    if (t.linkedKind !== kind) return
    if (t.completed) return
    batch.update(doc(db, 'tasks', d.id), {
      completed:   true,
      completedAt: now,
      completedBy: userUid,
    })
    count++
  })
  if (count > 0) {
    try {
      await batch.commit()
    } catch (err) {
      console.warn('[completeLinkedTasks] batch failed:', err)
    }
  }
  return count
}
