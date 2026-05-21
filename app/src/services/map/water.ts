// Helpers liés aux pins d'eau (manuel + naturel). Purs — pas de DOM, pas d'I/O.

import type { MapPin } from '../../types'

/**
 * Un point d'eau manuel est en retard si son échéance (`dueAt` ou
 * `nextReminderAt` en fallback) est déjà passée. Renvoie false pour les
 * pins d'un autre type.
 */
export function isWaterOverdue(pin: MapPin): boolean {
  if (pin.type !== 'water_manual') return false
  const deadline = pin.dueAt ?? pin.nextReminderAt
  return !!(deadline && deadline <= Date.now())
}
