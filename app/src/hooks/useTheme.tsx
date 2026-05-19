import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

type Theme = 'light' | 'dark'

const KEY = 'fm_theme'

function getInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'light'
  const saved = localStorage.getItem(KEY)
  if (saved === 'dark' || saved === 'light') return saved
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function applyTheme(theme: Theme) {
  const html = document.documentElement
  if (theme === 'dark') html.classList.add('dark')
  else html.classList.remove('dark')
}

// Application avant le premier render React pour éviter le flash blanc.
if (typeof window !== 'undefined') applyTheme(getInitialTheme())

interface ThemeCtx {
  theme: Theme
  toggleTheme: () => void
  setTheme: (t: Theme) => void
}

const ThemeContext = createContext<ThemeCtx | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(getInitialTheme)

  useEffect(() => {
    applyTheme(theme)
    try { localStorage.setItem(KEY, theme) } catch { /* localStorage indisponible */ }
  }, [theme])

  // Synchronise avec un autre onglet qui changerait le thème.
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === KEY && (e.newValue === 'dark' || e.newValue === 'light')) {
        setThemeState(e.newValue)
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  function setTheme(t: Theme) { setThemeState(t) }
  function toggleTheme() { setThemeState(t => t === 'dark' ? 'light' : 'dark') }

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme(): ThemeCtx {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme doit être utilisé dans <ThemeProvider>')
  return ctx
}
