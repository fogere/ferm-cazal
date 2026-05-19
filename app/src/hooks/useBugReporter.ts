import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { setReporterIdentity, pushAction } from '../services/bugReporter'
import { useAuth } from './useAuth'

/**
 * Connecte le bugReporter à l'état React :
 * - identité de l'utilisateur connecté (pour `reportedBy` sur les bug reports)
 * - tracker de navigation (chaque changement de route est ajouté au buffer d'actions)
 *
 * À monter une seule fois, dans App.tsx, à l'intérieur de AuthProvider + Router.
 */
export function useBugReporter() {
  const { user, profile } = useAuth()
  const location = useLocation()

  // Synchroniser l'identité avec le service global
  useEffect(() => {
    setReporterIdentity(user?.uid ?? null, profile?.displayName ?? null)
  }, [user?.uid, profile?.displayName])

  // Tracker les changements de route
  useEffect(() => {
    pushAction('nav', `→ ${location.pathname}${location.search}`)
  }, [location.pathname, location.search])
}
