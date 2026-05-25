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

/**
 * 3 profils GPS — demande Nils 24/05/2026 (V4 #4). Permet à l'utilisatrice de
 * choisir le compromis batterie/précision selon sa situation :
 *   - low    : économie batterie (Wi-Fi/cell positioning OK, 5 min de fraîcheur)
 *   - medium : compromis par défaut (GPS satellite, 30 s de fraîcheur)
 *   - high   : terrain — précision max, intervalle court (5 s), pour suivi fin
 *
 * Stocké en localStorage par device car le choix est device-specific (un téléphone
 * qui chauffe au soleil veut "low", un PC fixe se moque du mode).
 */
export type GpsMode = 'low' | 'medium' | 'high'

interface GpsOptions {
  enableHighAccuracy: boolean
  maximumAge:         number
  timeout:            number
}

const GPS_OPTIONS: Record<GpsMode, GpsOptions> = {
  low:    { enableHighAccuracy: false, maximumAge: 300_000, timeout: 60_000 },
  medium: { enableHighAccuracy: true,  maximumAge: 30_000,  timeout: 45_000 },
  high:   { enableHighAccuracy: true,  maximumAge: 5_000,   timeout: 45_000 },
}

const GPS_MODE_LS_KEY = 'fm_gps_mode'

export function readGpsMode(): GpsMode {
  try {
    const v = localStorage.getItem(GPS_MODE_LS_KEY)
    if (v === 'low' || v === 'medium' || v === 'high') return v
  } catch { /* SSR / privé strict */ }
  return 'medium'
}

export function writeGpsMode(mode: GpsMode): void {
  try { localStorage.setItem(GPS_MODE_LS_KEY, mode) }
  catch { /* SSR / privé strict */ }
}

class LocationCore {
  private watchId:          number | null = null
  private subscribers       = new Map<symbol, PositionCallback>()
  private errorSubscribers  = new Map<symbol, ErrorCallback>()
  private lastUpdate:       GeoUpdate | null = null
  private mode:             GpsMode = readGpsMode()
  // Anti-spam logs : un warn par code d'erreur par session. Sans ça le buffer
  // ring du bugReporter se remplit de "Timeout expired" toutes les minutes.
  private geoLogged         = new Set<string>()
  // Bug Eugénie 23/05/2026 (téléphone qui chauffe) : on coupe le watch GPS
  // quand la PWA passe en arrière-plan (écran verrouillé, app minimisée).
  // Sans ça `enableHighAccuracy: true` consomme la batterie 24/24h alors que
  // l'utilisatrice ne regarde pas. Reprend automatiquement au visibilitychange.
  private visibilityBound   = false

  private ensureVisibilityListener() {
    if (this.visibilityBound || typeof document === 'undefined') return
    this.visibilityBound = true
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        // Page cachée → on coupe le watch mais on garde les subscribers
        // (resume automatique quand on revient).
        if (this.watchId !== null) {
          navigator.geolocation.clearWatch(this.watchId)
          this.watchId = null
        }
      } else if (this.subscribers.size > 0 && this.watchId === null) {
        // Bug Eugénie 24/05/2026 : au resume, on invalide la dernière position
        // connue. Sans ça, le marker "me" continue d'afficher l'ancienne
        // position pendant 10-30 s avant le premier nouveau fix GPS, alors
        // que l'utilisatrice s'est peut-être déplacée pendant la veille.
        this.lastUpdate = null
        this.start()
      }
    })
  }

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

    // Bug Eugénie 24/05/2026 (qualité GPS) : on ne replay PAS une lastUpdate
    // périmée. Sinon, après une longue mise en veille (page cachée), un nouveau
    // subscriber recevait une position d'il y a 5 min comme si elle était fraîche.
    // 30 s est le seuil sous lequel la position est encore "current" pour
    // l'usage typique de la PWA (geofence, marker me, live-share).
    const REPLAY_FRESH_MS = 30_000
    if (this.lastUpdate && Date.now() - this.lastUpdate.timestamp < REPLAY_FRESH_MS) {
      // Replay async pour ne pas perturber le flow d'effets React au mount
      const snapshot = this.lastUpdate
      queueMicrotask(() => {
        if (this.subscribers.has(key)) cb(snapshot)
      })
    }

    this.ensureVisibilityListener()

    // Si la page est cachée au moment du subscribe, on ne démarre pas tout
    // de suite — le visibilitychange handler s'en chargera quand on reviendra.
    const pageVisible = typeof document === 'undefined' || !document.hidden
    if (this.watchId === null && this.subscribers.size > 0 && pageVisible) {
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
    // Options : choisies par le profil GPS courant. Voir GPS_OPTIONS pour les
    // valeurs (low / medium / high). Demande Nils 24/05 (V4 #4).
    const opts = GPS_OPTIONS[this.mode]
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
      opts,
    )
  }

  /**
   * Change le profil GPS à chaud. Redémarre le watchPosition() en cours pour
   * que les nouvelles options s'appliquent (Android continue avec les
   * anciennes options jusqu'au prochain clearWatch + watchPosition).
   * Persistance via localStorage.
   */
  setMode(mode: GpsMode) {
    if (this.mode === mode) return
    this.mode = mode
    writeGpsMode(mode)
    if (this.watchId !== null) {
      this.stop()
      this.start()
    }
  }

  getMode(): GpsMode {
    return this.mode
  }

  private stop() {
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId)
      this.watchId = null
    }
  }
}

export const locationCore = new LocationCore()
