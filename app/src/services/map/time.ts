// Helpers de formatage de date/heure pour la carte et les fiches.
// Toutes les fonctions ici sont pures et locales (pas de fuseau imposé).

/**
 * <input type=date> "YYYY-MM-DD" → timestamp local midi (12:00:00).
 * Pourquoi midi : évite les décalages d'1 jour quand on convertit en UTC pour
 * Firestore et qu'on rebascule dans l'autre fuseau.
 */
export function dateInputToTs(s: string): number {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d, 12, 0, 0).getTime()
}

/**
 * Timestamp → "YYYY-MM-DD" en fuseau local — format attendu par <input type=date>.
 */
export function tsToDateInput(ts: number = Date.now()): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * "Vu il y a X j" / "vu hier" / "vu à l'instant" — pour les animaux où on
 * affiche la dernière vérif santé.
 */
export function formatAgo(ts?: number): string {
  if (!ts) return 'jamais vu en bonne santé'
  const age = Date.now() - ts
  const days = Math.floor(age / (24 * 60 * 60 * 1000))
  if (days < 1) {
    const hours = Math.floor(age / (60 * 60 * 1000))
    if (hours < 1) return 'vu à l’instant'
    return `vu il y a ${hours} h`
  }
  if (days === 1) return 'vu hier'
  return `vu il y a ${days} j`
}

/**
 * "À l'instant" / "Il y a N min/h/j" — pour les timestamps passés.
 */
export function timeAgo(ts: number): string {
  const mins = Math.floor((Date.now() - ts) / 60000)
  if (mins < 1)  return "À l'instant"
  if (mins < 60) return `Il y a ${mins} min`
  const h = Math.floor(mins / 60)
  if (h < 24)    return `Il y a ${h}h`
  return `Il y a ${Math.floor(h / 24)}j`
}

/**
 * "Maintenant !" / "Dans N min/h/j" — pour les échéances futures.
 */
export function timeUntil(ts: number): string {
  const diff = ts - Date.now()
  if (diff <= 0) return 'Maintenant !'
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `Dans ${mins} min`
  const h = Math.floor(mins / 60)
  if (h < 24)    return `Dans ${h}h`
  return `Dans ${Math.floor(h / 24)}j`
}
