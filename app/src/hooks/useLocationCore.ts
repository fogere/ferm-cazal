import { useEffect, useRef } from 'react'
import { locationCore, type GeoUpdate } from '../services/location/locationCore'

/**
 * Hook React qui s'abonne au flux de positions partagé. Le watchPosition()
 * Android sous-jacent n'est démarré qu'une fois, peu importe combien de hooks
 * appellent useLocationCore().
 *
 * @param onUpdate   callback à chaque nouvelle position
 * @param onError    callback en cas d'erreur GPS (optionnel)
 * @param enabled    si false, le hook ne s'abonne pas (utile pour gating
 *                   sur shareLocation / !isTemp / route, etc.)
 *
 * Les callbacks sont stockés dans des refs : ils peuvent changer entre
 * renders sans re-souscrire (évite de stop/start le watch à chaque setState).
 */
export function useLocationCore(
  onUpdate: (u: GeoUpdate) => void,
  onError?: (e: GeolocationPositionError) => void,
  enabled = true,
) {
  const updateRef = useRef(onUpdate)
  const errorRef  = useRef(onError)

  useEffect(() => { updateRef.current = onUpdate }, [onUpdate])
  useEffect(() => { errorRef.current  = onError  }, [onError])

  useEffect(() => {
    if (!enabled) return
    return locationCore.subscribe(
      u => updateRef.current?.(u),
      e => errorRef.current?.(e),
    )
  }, [enabled])
}
