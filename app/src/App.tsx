import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './hooks/useAuth'
import { useMessaging } from './hooks/useMessaging'
import { useLiveLocation } from './hooks/useLiveLocation'
import Layout from './components/layout/Layout'
import Toaster from './components/Toaster'

const Login      = lazy(() => import('./pages/Login'))
const Dashboard  = lazy(() => import('./pages/Dashboard'))
const Tasks      = lazy(() => import('./pages/Tasks'))
const MapPage    = lazy(() => import('./pages/Map'))
const Alerts     = lazy(() => import('./pages/Alerts'))
const SettingsPage = lazy(() => import('./pages/Settings'))
const AdminPage    = lazy(() => import('./pages/Admin'))

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

function AppRoutes() {
  return (
    <>
      <MessagingLayer />
      <LocationLayer />
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
            <Route path="/admin"     element={<AdminRoute><AdminPage /></AdminRoute>} />
          </Route>
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </Suspense>
    </>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  )
}
