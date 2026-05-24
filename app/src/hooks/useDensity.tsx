import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

/**
 * Mode densité UI — taille des contrôles + chrome de l'app.
 *
 * Pourquoi (bug Eugénie/Benoît 23/05/2026) : leurs téléphones Android ont
 * "Taille d'affichage" / "Taille du texte" en grand (accessibilité), ce qui fait
 * gonfler tous les `rem` Tailwind. On a déjà cap la base via clamp() dans
 * index.css, mais si ça reste trop gros pour eux, ce mode ajoute un second
 * cran de réduction (75% au lieu de 100%).
 *
 * Pourquoi par-device (localStorage) et non par-user (Firestore) :
 * - C'est un réglage d'affichage local, lié au téléphone, pas au compte.
 * - Eugénie peut activer chez elle sans impacter shaza qui se connecte
 *   sur le même compte depuis un autre téléphone.
 * - Aucune écriture Firestore = aucune consommation de quota Spark.
 */

type Density = 'normal' | 'compact'

const KEY = 'fm_ui_density'

function getInitial(): Density {
  if (typeof window === 'undefined') return 'normal'
  const v = localStorage.getItem(KEY)
  return v === 'compact' ? 'compact' : 'normal'
}

function apply(d: Density) {
  const html = document.documentElement
  if (d === 'compact') html.classList.add('ui-compact')
  else html.classList.remove('ui-compact')
}

// Avant le premier render React, pour éviter un flash de la grosse taille.
if (typeof window !== 'undefined') apply(getInitial())

interface DensityCtx {
  density: Density
  setDensity: (d: Density) => void
  toggle: () => void
}

const DensityContext = createContext<DensityCtx | null>(null)

export function DensityProvider({ children }: { children: ReactNode }) {
  const [density, setDensityState] = useState<Density>(getInitial)

  useEffect(() => {
    apply(density)
    try { localStorage.setItem(KEY, density) } catch { /* localStorage indisponible */ }
  }, [density])

  // Sync entre onglets — si Eugénie a 2 onglets ouverts, switcher dans l'un
  // met aussi à jour l'autre.
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === KEY && (e.newValue === 'compact' || e.newValue === 'normal')) {
        setDensityState(e.newValue)
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  function setDensity(d: Density) { setDensityState(d) }
  function toggle() { setDensityState(d => d === 'compact' ? 'normal' : 'compact') }

  return (
    <DensityContext.Provider value={{ density, setDensity, toggle }}>
      {children}
    </DensityContext.Provider>
  )
}

export function useDensity(): DensityCtx {
  const ctx = useContext(DensityContext)
  if (!ctx) throw new Error('useDensity doit être utilisé dans <DensityProvider>')
  return ctx
}
