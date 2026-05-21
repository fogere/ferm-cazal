// Singleton qui gère UN SEUL navigator.geolocation.watchPosition() partagé
// par tous les consumers (useLiveLocation, useGeofenceAlert, useOnDemandLocationPublish).
//
// Avant : chaque hook montait son propre watchPosition() → 3 watch en parallèle
// sur Android, qui se marchent dessus, multiplient les "Timeout expired", et
// consomment 3× la batterie pour la même info GPS.
//
// Après : un seul watch démarre quand au moins un subscriber existe, s'arrête
// quand le dernier se désabonne. Chaque consumer reçoit la même position et
// applique son propre throttling / logique métier.

export type GeoUpdate = {
  lat:       number
  lng:       number
  accuracy:  number
  timestamp: number
}

type PositionCallback = (u: GeoUpdate) => void
type ErrorCallback    = (e: GeolocationPositionError) => void

class LocationCore {
  private watchId:          number | null = null
  private subscribers       = new Map<symbol, PositionCallback>()
  private errorSubscribers  = new Map<symbol, ErrorCallback>()
  private lastUpdate:       GeoUpdate | null = null
  // Anti-spam logs : un warn par code d'erreur par session. Sans ça le buffer
  // ring du bugReporter se remplit de "Timeout expired" toutes les minutes.
  private geoLogged         = new Set<string>()

  /**
   * S'abonne au flux de positions. Démarre le watchPosition() si c'est le
   * premier subscriber. Retourne une fonction de désabonnement.
   *
   * Si une position récente existe déjà (lastUpdate), elle est replay-ée
   * immédiatement au callback — utile pour les consumers qui sont montés
   * après le premier fix.
   */
  subscribe(cb: PositionCallback, errCb?: ErrorCallback): () => void {
    const key = Symbol()
    this.subscribers.set(key, cb)
    if (errCb) this.errorSubscribers.set(key, errCb)

    if (this.lastUpdate) {
      // Replay async pour ne pas perturber le flow d'effets React au mount
      const snapshot = this.lastUpdate
      queueMicrotask(() => {
        if (this.subscribers.has(key)) cb(snapshot)
      })
    }

    if (this.watchId === null && this.subscribers.size > 0) {
      this.start()
    }

    return () => {
      this.subscribers.delete(key)
      this.errorSubscribers.delete(key)
      if (this.subscribers.size === 0) {
        this.stop()
      }
    }
  }

  /**
   * Retourne la dernière position connue si elle a moins de `maxAgeMs`,
   * sinon null. Ne déclenche aucun fix GPS — c'est volontaire : les
   * consumers "best effort" (ex: useOnDemandLocationPublish) doivent
   * réutiliser ce qui est déjà disponible plutôt que réveiller le GPS.
   */
  getRecentPosition(maxAgeMs: number = 60_000): GeoUpdate | null {
    if (!this.lastUpdate) return null
    if (Date.now() - this.lastUpdate.timestamp > maxAgeMs) return null
    return this.lastUpdate
  }

  private start() {
    if (!('geolocation' in navigator)) return
    // Options unifiées : enableHighAccuracy=true (bug Eugénie 21/05 — sinon
    // Wi-Fi positioning → 500 m d'erreur), timeout 45 s (cold start GPS
    // outdoor sur Android peut prendre 20-30 s), maximumAge 30 s (les
    // consumers throttlent eux-mêmes plus fin).
    this.watchId = navigator.geolocation.watchPosition(
      pos => {
        const update: GeoUpdate = {
          lat:       pos.coords.latitude,
          lng:       pos.coords.longitude,
          accuracy:  pos.coords.accuracy,
          timestamp: Date.now(),
        }
        this.lastUpdate = update
        this.subscribers.forEach(cb => cb(update))
      },
      err => {
        const key = String(err.code ?? err.message)
        if (!this.geoLogged.has(key)) {
          this.geoLogged.add(key)
          console.warn('[locationCore]', err.message, '(logué une seule fois/session)')
        }
        this.errorSubscribers.forEach(cb => cb(err))
      },
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: 45_000 },
    )
  }

  private stop() {
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId)
      this.watchId = null
    }
  }
}

export const locationCore = new LocationCore()
