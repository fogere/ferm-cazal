import { useEffect, useState } from 'react'

type Theme = 'light' | 'dark'

const KEY = 'fm_theme'

function getInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'light'
  const saved = localStorage.getItem(KEY)
  if (saved === 'dark' || saved === 'light') return saved
  // Sinon : suit la préférence système
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function applyTheme(theme: Theme) {
  const html = document.documentElement
  if (theme === 'dark') html.classList.add('dark')
  else html.classList.remove('dark')
}

export function useTheme(): { theme: Theme; toggleTheme: () => void; setTheme: (t: Theme) => void } {
  const [theme, setThemeState] = useState<Theme>(getInitialTheme)

  useEffect(() => {
    applyTheme(theme)
    localStorage.setItem(KEY, theme)
  }, [theme])

  function setTheme(t: Theme) { setThemeState(t) }
  function toggleTheme() { setThemeState(t => t === 'dark' ? 'light' : 'dark') }

  return { theme, toggleTheme, setTheme }
}

// Applique le thème dès le chargement du module (avant le premier render React)
// pour éviter le flash blanc
if (typeof window !== 'undefined') {
  applyTheme(getInitialTheme())
}
