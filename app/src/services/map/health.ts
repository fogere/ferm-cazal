// Helpers pour le suivi de la fraîcheur des observations santé d'un animal.

// Délais (ms) au-delà desquels on signale qu'un animal n'a pas été vu.
export const HEALTH_OK_MS   = 2 * 24 * 60 * 60 * 1000  // < 2 j : OK (vert)
export const HEALTH_WARN_MS = 7 * 24 * 60 * 60 * 1000  // < 7 j : attention (jaune)
                                                       // ≥ 7 j : alerte (rouge)

export type HealthFreshness = 'ok' | 'warn' | 'stale' | 'never'

export function healthFreshness(ts?: number): HealthFreshness {
  if (!ts) return 'never'
  const age = Date.now() - ts
  if (age < HEALTH_OK_MS)   return 'ok'
  if (age < HEALTH_WARN_MS) return 'warn'
  return 'stale'
}

/** Classe Tailwind associée à un niveau de fraîcheur, pour les pastilles. */
export function healthDotClass(f: HealthFreshness): string {
  switch (f) {
    case 'ok':    return 'bg-meadow'
    case 'warn':  return 'bg-sun'
    case 'stale': return 'bg-danger'
    case 'never': return 'bg-muted/40'
  }
}
