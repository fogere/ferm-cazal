// Helpers de compatibilité pour la migration fence → land_plot (S2.5/S3).
// Pur — pas de DOM, pas d'I/O.
//
// Pendant et après la migration, un fence "enclos" garde son existence
// visuelle, mais son rôle de "réceptacle d'animaux" est transféré à un
// land_plot jumeau (créé par scripts/migrate-fence-to-landplot.cjs).
//
// `animal.enclosureId` peut donc pointer :
//   - vers le fence.id (avant migration ou pour les fences non migrés)
//   - vers le land_plot.id (après migration)
//
// Ce helper résout l'identifiant logique de l'enclos pour un pin fence,
// permettant aux comparaisons côté UI de continuer à fonctionner peu importe
// l'état de la migration.

import type { MapPin } from '../../types'

/**
 * Renvoie l'id à utiliser pour comparer avec `animal.enclosureId` /
 * `enclosure_movements.{from,to}EnclosureId` quand on regarde un fence.
 *
 * - Si le fence a été migré (migratedToPlotId présent) → renvoie le plot id
 * - Sinon (cas hérité, fence pas encore migré) → renvoie l'id du fence
 *
 * Pour les pins de type land_plot, renvoie directement leur id (jamais
 * migré, c'est déjà la cible).
 */
export function effectiveEnclosureId(pin: MapPin): string {
  return pin.migratedToPlotId ?? pin.id
}

/**
 * Renvoie la liste des ids à utiliser dans une query Firestore
 * `where('toEnclosureId', 'in', ...)` pour récupérer l'historique d'un fence,
 * en couvrant à la fois les anciens mouvements (vers fence.id) et les
 * nouveaux (vers plot.id) si une migration partielle est en cours.
 *
 * Note : Firestore `in` supporte jusqu'à 10 valeurs, on en utilise 1 ou 2.
 */
export function enclosureQueryIds(pin: MapPin): string[] {
  if (pin.migratedToPlotId && pin.migratedToPlotId !== pin.id) {
    return [pin.id, pin.migratedToPlotId]
  }
  return [pin.id]
}
