import { lazy, Suspense, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './hooks/useAuth'
import { ThemeProvider } from './hooks/useTheme'
import { useMessaging } from './hooks/useMessaging'
import { useLiveLocation } from './hooks/useLiveLocation'
import { useBugReporter } from './hooks/useBugReporter'
import Layout from './components/layout/Layout'
import Toaster from './components/Toaster'
import ErrorBoundary from './components/ErrorBoundary'
import BugReportButton from './components/BugReportButton'
import OfflineIndicator from './components/OfflineIndicator'
import OnboardingModal from './components/OnboardingModal'
import InstallPWAPrompt from './components/InstallPWAPrompt'
import UpdatePrompt from './components/UpdatePrompt'
import EveningRecapModal from './components/EveningRecapModal'

const Login      = lazy(() => import('./pages/Login'))
const Dashboard  = lazy(() => import('./pages/Dashboard'))
const Tasks      = lazy(() => import('./pages/Tasks'))
const MapPage    = lazy(() => import('./pages/Map'))
const Alerts     = lazy(() => import('./pages/Alerts'))
const SettingsPage = lazy(() => import('./pages/Settings'))
const AdminPage    = lazy(() => import('./pages/Admin'))
const BugsPage     = lazy(() => import('./pages/Bugs'))

function LoadingScreen() {
  return (
    <div className="flex h-full items-center justify-center bg-cream">
      <div className="flex flex-col items-center gap-3">
        <span className="text-5xl" role="img">🌿</span>
        <div className="flex gap-1.5">
          {[0,1,2].map(i => (
            <div key={i}
                 className="w-2 h-2 rounded-full bg-meadow animate-bounce"
                 style={{ animationDelay: `${i * 0.15}s` }} />
          ))}
        </div>
      </div>
    </div>
  )
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <LoadingScreen />
  if (!user) return <Navigate to="/login" replace />
  return <>{children}</>
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const { user, isTemp, loading } = useAuth()
  if (loading) return <LoadingScreen />
  if (!user || isTemp) return <Navigate to="/dashboard" replace />
  return <>{children}</>
}

function PublicRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <LoadingScreen />
  if (user) return <Navigate to="/dashboard" replace />
  return <>{children}</>
}

/* Notifications FCM + toasts — actif uniquement quand connecté */
function MessagingLayer() {
  const { toasts, dismiss } = useMessaging()
  return <Toaster toasts={toasts} dismiss={dismiss} />
}

/* Géolocalisation : tracker la position pendant que connecté (opt-in) */
function LocationLayer() {
  useLiveLocation()
  return null
}

/* Branche le bugReporter à l'auth + au router (nav tracking) */
function BugReporterLayer() {
  useBugReporter()
  return null
}

/* Préfetch des chunks lazy dès qu'on est connecté.
   Sans ça, chaque première navigation vers une page déclenche un Suspense fallback
   (flash "🌿 …") le temps que Vite télécharge le chunk JS.
   En préchargeant tout en arrière-plan après le login, les navigations
   suivantes sont instantanées. */
function ChunkPrefetcher() {
  const { user } = useAuth()
  useEffect(() => {
    if (!user) return
    // Importer chaque page = télécharge + parse le chunk, mais ne le rend pas.
    // requestIdleCallback laisse passer le rendu prioritaire d'abord.
    const idle = (cb: () => void) => {
      if ('requestIdleCallback' in window) {
        ;(window as Window & { requestIdleCallback?: (cb: () => void) => void })
          .requestIdleCallback!(cb)
      } else {
        setTimeout(cb, 200)
      }
    }
    idle(() => {
      // On ne se soucie pas des erreurs : si un chunk plante, l'app
      // affichera l'écran d'erreur classique au moment de la vraie navigation.
      import('./pages/Dashboard').catch(() => {})
      import('./pages/Tasks').catch(() => {})
      import('./pages/Map').catch(() => {})
      import('./pages/Alerts').catch(() => {})
      import('./pages/Settings').catch(() => {})
      import('./pages/Bugs').catch(() => {})
      import('./pages/Admin').catch(() => {})
    })
  }, [user])
  return null
}

/* Bouton 🐞 flottant — visible uniquement si connecté */
function FloatingBugButton() {
  const { user } = useAuth()
  if (!user) return null
  return <BugReportButton />
}

/* Onboarding (demande permissions notifs + GPS) — uniquement si connecté */
function OnboardingLayer() {
  const { user } = useAuth()
  if (!user) return null
  return <OnboardingModal />
}

/* Bannière install PWA — uniquement si connecté */
function InstallPromptLayer() {
  const { user } = useAuth()
  if (!user) return null
  return <InstallPWAPrompt />
}

/* Bilan du soir auto à 18h+ — uniquement si connecté en compte régulier */
function EveningRecapLayer() {
  const { user, isTemp } = useAuth()
  if (!user || isTemp) return null
  return <EveningRecapModal />
}

function AppRoutes() {
  return (
    <ErrorBoundary>
      <UpdatePrompt />
      <OfflineIndicator />
      <MessagingLayer />
      <LocationLayer />
      <BugReporterLayer />
      <ChunkPrefetcher />
      <FloatingBugButton />
      <OnboardingLayer />
      <InstallPromptLayer />
      <EveningRecapLayer />
      <Suspense fallback={<LoadingScreen />}>
        <Routes>
          <Route path="/login" element={
            <PublicRoute><Login /></PublicRoute>
          } />
          <Route element={
            <ProtectedRoute><Layout /></ProtectedRoute>
          }>
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/tasks"     element={<Tasks />} />
            <Route path="/map"       element={<MapPage />} />
            <Route path="/alerts"    element={<Alerts />} />
            <Route path="/settings"  element={<SettingsPage />} />
            <Route path="/bugs"      element={<BugsPage />} />
            <Route path="/admin"     element={<AdminRoute><AdminPage /></AdminRoute>} />
          </Route>
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  )
}
