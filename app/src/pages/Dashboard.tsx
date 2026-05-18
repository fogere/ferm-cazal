import { useEffect, useState, useCallback, useMemo } from 'react'
import {
  Wind, Thermometer, Droplets, CheckCircle2, Circle,
  AlertTriangle, ChevronRight, RefreshCw, Flame, Stethoscope,
  Navigation, Zap,
} from 'lucide-react'
import { doc, updateDoc, collection, query, where, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../hooks/useAuth'
import { fetchWeather, getWeatherInfo, computeVigilance, computeFireRisk } from '../services/weather'
import type { WeatherData, Task, Availability, FermeAlert, VigilanceLevel, FireRiskLevel, MapPin, Animal, AnimalCareEntry, Reserve } from '../types'

// Distance haversine en mètres entre deux coordonnées GPS
function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat), lat2 = toRad(b.lat)
  const x = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2)
  return 2 * R * Math.asin(Math.sqrt(x))
}

function formatDistance(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`
  return `${(m / 1000).toFixed(1)} km`
}

function timeFromNow(ts: number): { text: string; overdue: boolean; soon: boolean } {
  const diff = ts - Date.now()
  const overdue = diff <= 0
  const hours = Math.abs(diff) / 3_600_000
  const soon = !overdue && hours <= 4

  let text: string
  if (hours < 1) {
    const mins = Math.max(1, Math.round(Math.abs(diff) / 60_000))
    text = `${mins} min`
  } else if (hours < 24) {
    text = `${Math.round(hours)} h`
  } else {
    text = `${Math.round(hours / 24)} j`
  }
  return { text: overdue ? `Dépassée ${text}` : `Dans ${text}`, overdue, soon }
}

const DAYS_FR = ['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi']
const MONTHS_FR = ['jan.','fév.','mars','avr.','mai','juin','juil.','août','sep.','oct.','nov.','déc.']

const AVAILABILITY_OPTIONS: { value: Availability; label: string; color: string; bg: string }[] = [
  { value: 'available',   label: 'Disponible',   color: 'text-meadow',  bg: 'bg-meadow/10 border-meadow/30' },
  { value: 'limited',     label: 'Limité',        color: 'text-sun',     bg: 'bg-sun/10 border-sun/30' },
  { value: 'unavailable', label: 'Indisponible',  color: 'text-danger',  bg: 'bg-danger/10 border-danger/30' },
]

const SEVERITY_STYLE: Record<string, { border: string; icon: string }> = {
  urgent:  { border: 'border-l-danger',  icon: 'text-danger' },
  warning: { border: 'border-l-sun',     icon: 'text-sun' },
  info:    { border: 'border-l-sky',     icon: 'text-sky' },
}

function formatDate() {
  const now = new Date()
  return `${DAYS_FR[now.getDay()]} ${now.getDate()} ${MONTHS_FR[now.getMonth()]}`
}

const VIGILANCE_CFG: Record<VigilanceLevel, { bg: string; text: string; label: string }> = {
  Vert:   { bg: 'bg-meadow/20',  text: 'text-meadow', label: '🟢 Vigilance verte' },
  Jaune:  { bg: 'bg-sun/20',     text: 'text-earth',  label: '🟡 Vigilance jaune' },
  Orange: { bg: 'bg-orange-500/20', text: 'text-orange-700', label: '🟠 Vigilance orange' },
  Rouge:  { bg: 'bg-danger/20',  text: 'text-danger', label: '🔴 Vigilance rouge' },
}

const FIRE_CFG: Record<NonNullable<FireRiskLevel>, { bg: string; text: string }> = {
  'Faible':      { bg: 'bg-meadow/20',     text: 'text-meadow' },
  'Modéré':      { bg: 'bg-sun/20',        text: 'text-earth' },
  'Élevé':       { bg: 'bg-orange-500/20', text: 'text-orange-700' },
  'Très élevé':  { bg: 'bg-danger/20',     text: 'text-danger' },
}

function VigilanceBadge({ level }: { level: VigilanceLevel }) {
  const cfg = VIGILANCE_CFG[level]
  return (
    <div className={`flex-1 flex items-center gap-1.5 px-3 py-2 rounded-xl ${cfg.bg}`}>
      <span className={`text-xs font-semibold ${cfg.text}`}>{cfg.label}</span>
    </div>
  )
}

function FireRiskBadge({ level }: { level: NonNullable<FireRiskLevel> }) {
  const cfg = FIRE_CFG[level]
  return (
    <div className={`flex-1 flex items-center gap-1.5 px-3 py-2 rounded-xl ${cfg.bg}`}>
      <Flame size={13} className={cfg.text} />
      <span className={`text-xs font-semibold ${cfg.text}`}>Feux : {level}</span>
    </div>
  )
}

export default function Dashboard() {
  const { user, profile } = useAuth()

  const [weather,    setWeather]    = useState<WeatherData | null>(null)
  const [vigilance,  setVigilance]  = useState<VigilanceLevel>('Vert')
  const [fireRisk,   setFireRisk]   = useState<FireRiskLevel>(null)
  const [weatherLoading, setWeatherLoading] = useState(true)

  const [tasks, setTasks] = useState<Task[]>([])
  const [alerts, setAlerts] = useState<FermeAlert[]>([])
  const [availability, setAvailability] = useState<Availability>(profile?.availability ?? 'available')
  const [waterPins, setWaterPins] = useState<MapPin[]>([])
  const [refillBusy, setRefillBusy] = useState<string | null>(null)
  const [careEntries, setCareEntries] = useState<AnimalCareEntry[]>([])
  const [animals, setAnimals] = useState<Animal[]>([])

  // Réserves
  const [reserves, setReserves] = useState<Reserve[]>([])

  // Chargement météo (1 fois au montage, avec cache 1h en mémoire)
  const loadWeather = useCallback(async () => {
    setWeatherLoading(true)
    try {
      const data = await fetchWeather()
      setWeather(data)
      setVigilance(computeVigilance(data))
      setFireRisk(computeFireRisk(data))
    } catch {
      // silencieux — affiche état indisponible
    } finally {
      setWeatherLoading(false)
    }
  }, [])

  useEffect(() => { loadWeather() }, [loadWeather])

  // Tâches assignées — filtrées côté client pour éviter l'index composite Firestore
  useEffect(() => {
    if (!user) return
    const q = query(collection(db, 'tasks'), where('assignedTo', '==', user.uid))
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
    const todayEnd   = new Date(); todayEnd.setHours(23, 59, 59, 999)

    const unsub = onSnapshot(q, snap => {
      const all = snap.docs.map(d => ({ id: d.id, ...d.data() } as Task))
      // Garde uniquement les tâches d'aujourd'hui (non complétées ou complétées aujourd'hui)
      const todayTasks = all.filter(t => {
        const due = t.dueDate
        return due >= todayStart.getTime() && due <= todayEnd.getTime()
      })
      setTasks(todayTasks)
    })
    return unsub
  }, [user])

  // Alertes actives en temps réel
  useEffect(() => {
    const q = query(collection(db, 'alerts'), where('resolved', '==', false))
    const unsub = onSnapshot(q, snap => {
      const all = snap.docs.map(d => ({ id: d.id, ...d.data() } as FermeAlert))
      all.sort((a, b) => {
        const order = { urgent: 0, warning: 1, info: 2 }
        return (order[a.severity] ?? 3) - (order[b.severity] ?? 3)
      })
      setAlerts(all)
    })
    return unsub
  }, [])

  // Points d'eau manuels (pour section "Eau à surveiller")
  useEffect(() => {
    const q = query(collection(db, 'map_pins'), where('type', '==', 'water_manual'))
    const unsub = onSnapshot(q, snap =>
      setWaterPins(snap.docs.map(d => ({ id: d.id, ...d.data() } as MapPin)))
    )
    return unsub
  }, [])

  // Batteries (pour mode tournée)
  const [batteryPins, setBatteryPins] = useState<MapPin[]>([])
  useEffect(() => {
    const q = query(collection(db, 'map_pins'), where('type', '==', 'battery'))
    const unsub = onSnapshot(q, snap =>
      setBatteryPins(snap.docs.map(d => ({ id: d.id, ...d.data() } as MapPin)))
    )
    return unsub
  }, [])

  // Animaux + carnet de soins (pour section "Soins à faire")
  useEffect(() => {
    const u1 = onSnapshot(collection(db, 'animals'), snap =>
      setAnimals(snap.docs.map(d => ({ id: d.id, ...d.data() } as Animal)))
    )
    const u2 = onSnapshot(collection(db, 'animal_care'), snap =>
      setCareEntries(snap.docs.map(d => ({ id: d.id, ...d.data() } as AnimalCareEntry)))
    )
    return () => { u1(); u2() }
  }, [])

  // Pluviomètre du mois courant
  // Réserves (pour alerte stock bas)
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'reserves'), snap =>
      setReserves(snap.docs.map(d => ({ id: d.id, ...d.data() } as Reserve)))
    )
    return unsub
  }, [])

  // Toutes les tâches (pour stats hebdo)
  const [allTasks, setAllTasks] = useState<Task[]>([])
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'tasks'), snap =>
      setAllTasks(snap.docs.map(d => ({ id: d.id, ...d.data() } as Task)))
    )
    return unsub
  }, [])

  // Réserves basses (stock <= seuil d'alerte)
  const lowReserves = useMemo(
    () => reserves.filter(r => r.currentQty <= r.alertThreshold)
                  .sort((a, b) => a.currentQty - b.currentQty),
    [reserves]
  )

  // ── Mode tournée : items urgents avec position, triés par distance depuis l'utilisateur ──
  // Item = { kind, name, lat, lng, status, action } - kinds : 'water' (eau à remplir), 'battery' (batterie à vérifier)
  type TourItem = {
    id: string; kind: 'water' | 'battery'
    name: string; lat: number; lng: number
    status: 'overdue' | 'soon' | 'normal'
    distance: number
  }
  const myPos = profile?.liveLocation
  const tourItems = useMemo<TourItem[]>(() => {
    if (!myPos) return []
    const now = Date.now()
    const items: TourItem[] = []

    // Points d'eau manuels en retard ou < 6h
    for (const p of waterPins) {
      const due = p.dueAt ?? 0
      if (due === 0 || due > now + 6 * 3_600_000) continue
      const overdue = due <= now
      const soon    = !overdue && due <= now + 4 * 3_600_000
      items.push({
        id: `w-${p.id}`, kind: 'water',
        name: p.name, lat: p.lat, lng: p.lng,
        status: overdue ? 'overdue' : soon ? 'soon' : 'normal',
        distance: distanceMeters(myPos, { lat: p.lat, lng: p.lng }),
      })
    }
    // Batteries à vérifier (nextCheckAt dépassé ou < 2 jours)
    for (const p of batteryPins) {
      const due = p.nextCheckAt ?? 0
      if (due === 0 || due > now + 2 * 86_400_000) continue
      const overdue = due <= now
      items.push({
        id: `b-${p.id}`, kind: 'battery',
        name: p.name, lat: p.lat, lng: p.lng,
        status: overdue ? 'overdue' : 'soon',
        distance: distanceMeters(myPos, { lat: p.lat, lng: p.lng }),
      })
    }

    return items.sort((a, b) => a.distance - b.distance).slice(0, 5)
  }, [myPos, waterPins, batteryPins])

  // Stats des 7 derniers jours pour le bilan hebdo
  const weeklyStats = useMemo(() => {
    const weekAgo = Date.now() - 7 * 86_400_000
    const tasksDone = allTasks.filter(t => t.completed && (t.completedAt ?? 0) >= weekAgo).length
    const careDone  = careEntries.filter(e => e.date >= weekAgo).length
    const refills   = waterPins.filter(p => (p.lastFilled ?? 0) >= weekAgo).length
    return { tasksDone, careDone, refills }
  }, [allTasks, careEntries, waterPins])

  // Dimanche = highlight
  const isSunday = new Date().getDay() === 0

  // Calcul des points d'eau urgents : dépassés ou échéance < 6h
  const urgentWater = useMemo(() => {
    const now = Date.now()
    const horizon = now + 6 * 3_600_000
    return waterPins
      .filter(p => p.dueAt && p.dueAt <= horizon)
      .sort((a, b) => (a.dueAt ?? 0) - (b.dueAt ?? 0))
  }, [waterPins])

  // Soins en retard (nextDueAt < now)
  const overdueCare = useMemo(() => {
    const now = Date.now()
    return careEntries
      .filter(e => e.nextDueAt && e.nextDueAt < now)
      .sort((a, b) => (a.nextDueAt ?? 0) - (b.nextDueAt ?? 0))
  }, [careEntries])

  async function refillWaterPoint(pin: MapPin) {
    if (!user) return
    setRefillBusy(pin.id)
    try {
      const interval    = pin.intervalHours    ?? 24
      const alertBefore = pin.alertBeforeHours ?? 3
      const now   = Date.now()
      const dueAt = now + interval * 3_600_000
      await updateDoc(doc(db, 'map_pins', pin.id), {
        lastFilled:     now,
        dueAt,
        nextReminderAt: Math.max(now, dueAt - alertBefore * 3_600_000),
        reminderSent:   false,
        status:         'ok',
        updatedAt:      now,
        updatedBy:      user.uid,
      })
    } finally { setRefillBusy(null) }
  }

  // Synchronisation disponibilité
  useEffect(() => {
    if (profile?.availability) setAvailability(profile.availability)
  }, [profile])

  async function updateAvailability(value: Availability) {
    if (!user) return
    setAvailability(value)
    await updateDoc(doc(db, 'users', user.uid), {
      availability:     value,
      availabilityDate: new Date().toISOString().split('T')[0],
    })
  }

  async function toggleTask(task: Task) {
    await updateDoc(doc(db, 'tasks', task.id), {
      completed:   !task.completed,
      completedAt: !task.completed ? Date.now() : null,
      completedBy: !task.completed ? user?.uid : null,
    })
  }

  async function resolveAlert(alertId: string) {
    await updateDoc(doc(db, 'alerts', alertId), {
      resolved:   true,
      resolvedAt: Date.now(),
      resolvedBy: user?.uid,
    })
  }

  const done = tasks.filter(t => t.completed).length
  const total = tasks.length

  return (
    <div className="pb-4">
      {/* En-tête vert */}
      <div className="px-5 pt-12 pb-6"
           style={{ background: 'linear-gradient(160deg, #1A4731 0%, #2D6A4F 100%)' }}>
        <p className="text-meadow-light text-sm font-medium capitalize">{formatDate()}</p>
        <h1 className="text-white text-2xl font-bold mt-0.5 mb-0">
          Bonjour {profile?.displayName ?? '…'} 👋
        </h1>

        {/* Météo */}
        <div className="mt-4">
          {weatherLoading ? (
            <div className="flex items-center gap-2 text-white/60 text-sm">
              <RefreshCw size={14} className="animate-spin" /> Chargement météo…
            </div>
          ) : weather ? (
            <div className="flex items-center gap-4 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="text-3xl" role="img">{getWeatherInfo(weather.weatherCode).emoji}</span>
                <div>
                  <p className="text-white text-2xl font-bold leading-none">{weather.temperature}°C</p>
                  <p className="text-meadow-light text-xs mt-0.5">
                    {weather.minTemp}° / {weather.maxTemp}°
                  </p>
                </div>
              </div>
              <div className="flex gap-3 text-white/80 text-sm">
                <span className="flex items-center gap-1">
                  <Wind size={14} /> {weather.windSpeed} km/h
                </span>
                {weather.precipitation > 0 && (
                  <span className="flex items-center gap-1">
                    <Droplets size={14} /> {weather.precipitation} mm
                  </span>
                )}
                <span className="flex items-center gap-1">
                  <Thermometer size={14} /> {getWeatherInfo(weather.weatherCode).label}
                </span>
              </div>
            </div>
          ) : (
            <button onClick={loadWeather}
                    className="flex items-center gap-1.5 text-white/60 text-sm active:text-white transition-colors">
              <RefreshCw size={14} /> Météo indisponible — Réessayer
            </button>
          )}
        </div>

        {/* Vigilance + Risque incendie */}
        {weather && (
          <div className="flex gap-2 mt-3">
            <VigilanceBadge level={vigilance} />
            {fireRisk && <FireRiskBadge level={fireRisk} />}
          </div>
        )}
      </div>

      <div className="px-4 space-y-4 mt-2">

        {/* Disponibilité du jour */}
        <div className="bg-card rounded-2xl p-4 shadow-sm">
          <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-3">
            Ma disponibilité aujourd'hui
          </p>
          <div className="flex gap-2">
            {AVAILABILITY_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => updateAvailability(opt.value)}
                className={`flex-1 py-2.5 rounded-xl border text-sm font-semibold transition-all active:scale-95 ${
                  availability === opt.value
                    ? `${opt.bg} ${opt.color}`
                    : 'border-border text-muted bg-cream'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Alertes actives */}
        {alerts.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted uppercase tracking-wider px-1">
              Alertes actives ({alerts.length})
            </p>
            {alerts.map(alert => {
              const style = SEVERITY_STYLE[alert.severity] ?? SEVERITY_STYLE.info
              return (
                <div key={alert.id}
                     className={`bg-card rounded-2xl p-4 shadow-sm border-l-4 ${style.border} flex items-start gap-3`}>
                  <AlertTriangle size={18} className={`flex-shrink-0 mt-0.5 ${style.icon}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-charcoal text-sm font-medium leading-snug">{alert.message}</p>
                  </div>
                  <button
                    onClick={() => resolveAlert(alert.id)}
                    className="flex-shrink-0 text-xs text-muted font-medium px-3 py-1.5 rounded-lg bg-cream active:bg-border transition-colors"
                  >
                    Résolu
                  </button>
                </div>
              )
            })}
          </div>
        )}

        {/* Mode tournée — visible uniquement si position GPS partagée */}
        {profile?.shareLocation && myPos && tourItems.length > 0 && (
          <div className="bg-card rounded-2xl p-4 shadow-sm">
            <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <Navigation size={14} className="text-forest" /> Tournée terrain ({tourItems.length})
            </p>
            <p className="text-xs text-muted mb-3 leading-relaxed">
              Items urgents triés par proximité depuis ta position actuelle.
            </p>
            <ul className="space-y-1.5">
              {tourItems.map(item => {
                const bg = item.status === 'overdue' ? 'bg-danger/5 border-danger/30'
                         : item.status === 'soon'    ? 'bg-sun/5 border-sun/30'
                         :                             'bg-cream border-border/40'
                const Icon = item.kind === 'water' ? Droplets : Zap
                const iconColor = item.kind === 'water' ? 'text-sky' : 'text-sun'
                return (
                  <li key={item.id}
                      className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border ${bg}`}>
                    <Icon size={18} className={`flex-shrink-0 ${iconColor}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-charcoal truncate">{item.name}</p>
                      <p className="text-xs text-muted">
                        {item.kind === 'water' ? 'Eau à remplir' : 'Batterie à vérifier'}
                        {item.status === 'overdue' && <span className="text-danger font-bold ml-1">· dépassé</span>}
                      </p>
                    </div>
                    <p className="text-sm font-bold text-forest whitespace-nowrap">
                      {formatDistance(item.distance)}
                    </p>
                  </li>
                )
              })}
            </ul>
            <a href="/map"
               className="flex items-center justify-center gap-1 text-forest text-xs font-semibold mt-2 py-1.5 rounded-lg active:bg-meadow/10 transition-colors">
              Ouvrir la carte <ChevronRight size={14} />
            </a>
          </div>
        )}

        {/* Eau à surveiller */}
        {urgentWater.length > 0 && (
          <div className="bg-card rounded-2xl p-4 shadow-sm">
            <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <Droplets size={14} className="text-sky" /> Eau à surveiller ({urgentWater.length})
            </p>
            <ul className="space-y-2">
              {urgentWater.map(pin => {
                const due = pin.dueAt ?? 0
                const status = timeFromNow(due)
                const bg = status.overdue ? 'bg-danger/10 border-danger/30'
                        : status.soon    ? 'bg-sun/10 border-sun/30'
                        :                  'bg-sky/5 border-sky/20'
                const txt = status.overdue ? 'text-danger' : status.soon ? 'text-earth' : 'text-sky'
                return (
                  <li key={pin.id}
                      className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border ${bg}`}>
                    <Droplets size={18} className={`flex-shrink-0 ${txt}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-charcoal truncate">{pin.name}</p>
                      <p className={`text-xs font-medium ${txt}`}>{status.text}</p>
                    </div>
                    <button
                      onClick={() => refillWaterPoint(pin)}
                      disabled={refillBusy === pin.id}
                      className="px-3 py-1.5 rounded-lg bg-forest text-white text-xs font-bold
                                 active:scale-95 disabled:opacity-50 transition-all whitespace-nowrap"
                    >
                      {refillBusy === pin.id ? '…' : '✓ Rempli'}
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        )}

        {/* Réserves basses */}
        {lowReserves.length > 0 && (
          <div className="bg-card rounded-2xl p-4 shadow-sm">
            <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-3 flex items-center gap-1.5">
              🌾 Réserves basses ({lowReserves.length})
            </p>
            <ul className="space-y-1.5">
              {lowReserves.slice(0, 5).map(r => (
                <li key={r.id}
                    className="flex items-center justify-between px-3 py-2 rounded-xl bg-danger/5 border border-danger/20">
                  <p className="text-sm font-semibold text-charcoal truncate">{r.name}</p>
                  <p className="text-xs font-bold text-danger whitespace-nowrap ml-2">
                    {r.currentQty} {r.unit}
                    <span className="text-muted font-normal ml-1">/ {r.alertThreshold}</span>
                  </p>
                </li>
              ))}
            </ul>
            <a href="/admin"
               className="flex items-center justify-center gap-1 text-forest text-xs font-semibold mt-2 py-1.5 rounded-lg active:bg-meadow/10 transition-colors">
              Gérer les réserves <ChevronRight size={14} />
            </a>
          </div>
        )}

        {/* Soins à faire (overdue) */}
        {overdueCare.length > 0 && (
          <div className="bg-card rounded-2xl p-4 shadow-sm">
            <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <Stethoscope size={14} className="text-danger" /> Soins à faire ({overdueCare.length})
            </p>
            <ul className="space-y-1.5">
              {overdueCare.slice(0, 6).map(e => {
                const animal = animals.find(a => a.id === e.animalId)
                if (!animal) return null
                const daysLate = Math.ceil((Date.now() - (e.nextDueAt ?? 0)) / 86_400_000)
                return (
                  <li key={e.id}
                      className="flex items-center gap-3 px-3 py-2 rounded-xl bg-danger/5 border border-danger/20">
                    <span className="text-lg flex-shrink-0">{animal.species === 'horse' ? '🐎' : '🐴'}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-charcoal truncate">
                        {animal.name} <span className="text-muted font-normal">· {
                          e.type === 'vaccine'    ? 'Vaccin'
                        : e.type === 'vermifuge'  ? 'Vermifuge'
                        : e.type === 'parage'     ? 'Parage'
                        : e.type === 'vet_visit'  ? 'Visite véto'
                        : e.type === 'medication' ? 'Soin'
                        : e.type === 'breeding'   ? 'Mise bas prévue'
                        : e.type === 'birth'      ? 'Mise bas'
                        :                           'Autre'
                        }</span>
                      </p>
                      <p className="text-xs font-medium text-danger">
                        En retard de {daysLate} jour{daysLate > 1 ? 's' : ''}
                      </p>
                    </div>
                  </li>
                )
              })}
            </ul>
            <a href="/admin"
               className="flex items-center justify-center gap-1 text-forest text-xs font-semibold mt-2 py-1.5 rounded-lg active:bg-meadow/10 transition-colors">
              Gérer les soins <ChevronRight size={14} />
            </a>
          </div>
        )}

        {/* Mes tâches du jour */}
        <div className="bg-card rounded-2xl p-4 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold text-muted uppercase tracking-wider">
              Mes tâches du jour
            </p>
            {total > 0 && (
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                done === total ? 'bg-meadow/15 text-meadow' : 'bg-sun/15 text-earth'
              }`}>
                {done}/{total}
              </span>
            )}
          </div>

          {tasks.length === 0 ? (
            <div className="py-6 text-center">
              <p className="text-3xl mb-2">✅</p>
              <p className="text-muted text-sm">Aucune tâche pour aujourd'hui</p>
            </div>
          ) : (
            <ul className="space-y-1">
              {tasks.map(task => (
                <li key={task.id}>
                  <button
                    onClick={() => toggleTask(task)}
                    className="w-full flex items-center gap-3 py-3 px-1 rounded-xl active:bg-cream transition-colors text-left"
                  >
                    {task.completed
                      ? <CheckCircle2 size={22} className="text-meadow flex-shrink-0" />
                      : <Circle size={22} className="text-border flex-shrink-0" />
                    }
                    <span className={`flex-1 text-sm font-medium ${
                      task.completed ? 'line-through text-muted' : 'text-charcoal'
                    }`}>
                      {task.title}
                    </span>
                    {task.priority === 'urgent' && !task.completed && (
                      <span className="text-danger text-xs font-bold">URGENT</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* Lien vers toutes les tâches */}
          <a href="/tasks"
             className="flex items-center justify-center gap-1 text-forest text-sm font-semibold mt-3 py-2 rounded-xl active:bg-meadow/10 transition-colors">
            Voir toutes les tâches <ChevronRight size={16} />
          </a>
        </div>

        {/* Bilan de la semaine — toujours visible, plus visible le dimanche */}
        <div className={`rounded-2xl p-4 shadow-sm ${isSunday ? 'bg-forest text-white' : 'bg-card'}`}>
          <p className={`text-xs font-semibold uppercase tracking-wider mb-3 flex items-center gap-1.5 ${isSunday ? 'text-white/80' : 'text-muted'}`}>
            📊 Bilan des 7 derniers jours
            {isSunday && <span className="text-white/60 normal-case font-normal">· nouveau cycle</span>}
          </p>
          <div className="grid grid-cols-3 gap-2.5">
            <div className={`rounded-xl px-3 py-2.5 ${isSunday ? 'bg-white/10' : 'bg-cream'}`}>
              <p className={`text-2xl font-bold ${isSunday ? 'text-white' : 'text-charcoal'}`}>{weeklyStats.tasksDone}</p>
              <p className={`text-[11px] leading-tight ${isSunday ? 'text-white/70' : 'text-muted'}`}>tâche{weeklyStats.tasksDone > 1 ? 's' : ''} faite{weeklyStats.tasksDone > 1 ? 's' : ''}</p>
            </div>
            <div className={`rounded-xl px-3 py-2.5 ${isSunday ? 'bg-white/10' : 'bg-cream'}`}>
              <p className={`text-2xl font-bold ${isSunday ? 'text-white' : 'text-charcoal'}`}>{weeklyStats.refills}</p>
              <p className={`text-[11px] leading-tight ${isSunday ? 'text-white/70' : 'text-muted'}`}>eau rempli{weeklyStats.refills > 1 ? 's' : ''}</p>
            </div>
            <div className={`rounded-xl px-3 py-2.5 ${isSunday ? 'bg-white/10' : 'bg-cream'}`}>
              <p className={`text-2xl font-bold ${isSunday ? 'text-white' : 'text-charcoal'}`}>{weeklyStats.careDone}</p>
              <p className={`text-[11px] leading-tight ${isSunday ? 'text-white/70' : 'text-muted'}`}>soin{weeklyStats.careDone > 1 ? 's' : ''} enregistré{weeklyStats.careDone > 1 ? 's' : ''}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
