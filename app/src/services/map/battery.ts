// Helpers liés aux pins batterie. Purs — pas de DOM, pas d'I/O.

import type { MapPin } from '../../types'

/**
 * Une batterie est "due pour vérification" si `nextCheckAt` est dépassé.
 * Renvoie false pour les pins d'un autre type.
 */
export function isBatteryDue(pin: MapPin): boolean {
  if (pin.type !== 'battery') return false
  return !!(pin.nextCheckAt && pin.nextCheckAt <= Date.now())
}
