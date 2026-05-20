import { ArrowLeft, Check, Camera, Printer } from 'lucide-react'
import type { Animal, AnimalCareEntry, AnimalMeasurement, UserProfile } from '../../types'
import type { SpeciesInfo } from '../../services/species'

interface Props {
  animal:    Animal
  species:   SpeciesInfo
  careEntries:   AnimalCareEntry[]
  measurements:  AnimalMeasurement[]
  users:         UserProfile[]
  isTemp:        boolean
  onBack?:       () => void
  onMarkHealthy: () => void
  onAddPhoto:    () => void
  onPrint?:      () => void
  busyHealth?:   boolean
}

function ageLabel(birth?: number): string {
  if (!birth) return 'Âge inconnu'
  const diff = Date.now() - birth
  const years  = Math.floor(diff / (365.25 * 86_400_000))
  const months = Math.floor((diff - years * 365.25 * 86_400_000) / (30.44 * 86_400_000))
  if (years === 0) return `${months} mois`
  if (years < 2)   return `${years} an${years > 1 ? 's' : ''} ${months} mois`
  return `${years} ans`
}

function lifeStage(species: string, birth?: number): string {
  if (!birth) return ''
  const years = (Date.now() - birth) / (365.25 * 86_400_000)
  if (species === 'horse' || species === 'donkey') {
    if (years < 1)  return 'Poulain'
    if (years < 4)  return 'Jeune'
    if (years < 20) return 'Adulte'
    return 'Senior'
  }
  if (years < 1)  return 'Jeune'
  if (years < 8)  return 'Adulte'
  return 'Senior'
}

function nextDue(careEntries: AnimalCareEntry[]): { label: string; ts: number } | null {
  const future = careEntries
    .filter(e => e.nextDueAt && e.nextDueAt > Date.now())
    .sort((a, b) => (a.nextDueAt ?? 0) - (b.nextDueAt ?? 0))[0]
  if (!future) return null
  const days = Math.round((future.nextDueAt! - Date.now()) / 86_400_000)
  const labels: Record<string, string> = {
    vaccine: 'Vaccin', vermifuge: 'Vermifuge', parage: 'Parage',
    vet_visit: 'Véto', medication: 'Soin', breeding: 'Mise bas',
    birth: 'Mise bas', food: 'Croquettes', grooming: 'Toilettage', other: 'Rappel',
  }
  return { label: `${labels[future.type] ?? 'Rappel'} J+${days}`, ts: future.nextDueAt! }
}

function weightTrend(measurements: AnimalMeasurement[]): { current: number; deltaPerMonth: number } | null {
  const withWeight = measurements.filter(m => m.weightKg !== undefined).sort((a, b) => a.date - b.date)
  if (withWeight.length === 0) return null
  const current = withWeight[withWeight.length - 1].weightKg!
  if (withWeight.length === 1) return { current, deltaPerMonth: 0 }
  // Tendance sur les 90 derniers jours (ou tout l'historique si plus court)
  const cutoff = Date.now() - 90 * 86_400_000
  const recent = withWeight.filter(m => m.date >= cutoff)
  const series = recent.length >= 2 ? recent : withWeight
  const a = series[0], b = series[series.length - 1]
  const days = (b.date - a.date) / 86_400_000
  const deltaPerMonth = days > 0 ? ((b.weightKg! - a.weightKg!) / days) * 30 : 0
  return { current, deltaPerMonth }
}

function freshnessColor(ts?: number): string {
  if (!ts) return 'text-muted'
  const days = (Date.now() - ts) / 86_400_000
  if (days < 1) return 'text-meadow'
  if (days < 7) return 'text-forest'
  if (days < 30) return 'text-sun'
  return 'text-danger'
}

export default function AnimalHeader({
  animal, species, careEntries, measurements, users, isTemp,
  onBack, onMarkHealthy, onAddPhoto, onPrint, busyHealth,
}: Props) {
  const age = ageLabel(animal.birthDate)
  const stage = lifeStage(animal.species, animal.birthDate)
  const trend = weightTrend(measurements)
  const due = nextDue(careEntries)
  const lastCheck = animal.lastCheckedHealthy
  const checker = animal.lastCheckedHealthyBy
    ? users.find(u => u.uid === animal.lastCheckedHealthyBy)?.displayName
    : null
  const activeConds = (animal.conditions ?? []).filter(c => !c.resolvedAt).length

  const lastMeasure = measurements
    .slice()
    .sort((a, b) => b.date - a.date)[0]

  return (
    <div className="bg-gradient-to-b from-forest/8 to-card border-b border-border">
      {/* Bandeau navigation + actions */}
      <div className="flex items-center justify-between px-3 py-2">
        {onBack ? (
          <button
            onClick={onBack}
            className="p-2 rounded-xl text-charcoal active:bg-cream flex items-center gap-1 text-xs font-semibold"
          >
            <ArrowLeft size={16} /> Retour
          </button>
        ) : <div />}
        <div className="flex gap-1">
          {onPrint && (
            <button
              onClick={onPrint}
              className="p-2 rounded-xl text-charcoal active:bg-cream"
              title="Imprimer le carnet"
            >
              <Printer size={16} />
            </button>
          )}
        </div>
      </div>

      {/* Identité + photo */}
      <div className="flex items-center gap-3 px-4 pb-3">
        <div className="w-20 h-20 rounded-2xl bg-white border-2 border-forest/20 flex items-center justify-center text-4xl overflow-hidden shadow-sm flex-shrink-0">
          {animal.photoUrl
            ? <img src={animal.photoUrl} alt="" className="w-full h-full object-cover" />
            : species.emoji}
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-charcoal text-xl font-bold m-0 truncate">{animal.name}</h2>
          <p className="text-xs text-muted mt-0.5">
            {species.label}
            {animal.gender === 'male'    && ' · ♂'}
            {animal.gender === 'female'  && ' · ♀'}
            {animal.gender === 'gelding' && ' · Hongre'}
            {animal.gender === 'mare'    && ' · Jument'}
          </p>
          <p className="text-[11px] text-forest font-semibold mt-0.5">
            {stage && `${stage} · `}{age}
          </p>
          {(animal.sireNumber || animal.transponderId) && (
            <div className="flex flex-wrap gap-1 mt-1">
              {animal.sireNumber && <IdChip label="SIRE" value={animal.sireNumber} />}
              {animal.transponderId && <IdChip label="Puce" value={animal.transponderId} />}
            </div>
          )}
        </div>
      </div>

      {/* Stats — 4 chiffres clés */}
      <div className="px-3 pb-3 grid grid-cols-4 gap-1.5">
        <StatTile
          label="Poids"
          value={trend ? `${Math.round(trend.current)} kg` : '—'}
          sub={trend && trend.deltaPerMonth !== 0
            ? `${trend.deltaPerMonth > 0 ? '+' : ''}${trend.deltaPerMonth.toFixed(1)} kg/m`
            : 'stable'}
          tone={trend ? (Math.abs(trend.deltaPerMonth) < 2 ? 'good' : 'warn') : 'neutral'}
        />
        <StatTile
          label="Garrot"
          value={lastMeasure?.withersCm ? `${lastMeasure.withersCm} cm` : '—'}
          sub={lastMeasure?.date ? new Date(lastMeasure.date).toLocaleDateString('fr-FR', { month: 'short' }) : '—'}
          tone="neutral"
        />
        <StatTile
          label="ECS"
          value={lastMeasure?.ecs ? `${lastMeasure.ecs}/${lastMeasure.ecsScale === '1-9' ? '9' : '5'}` : '—'}
          sub={ecsLabel(lastMeasure?.ecs, lastMeasure?.ecsScale)}
          tone={ecsTone(lastMeasure?.ecs, lastMeasure?.ecsScale)}
        />
        <StatTile
          label="Santé"
          value={activeConds === 0 ? '✓' : `${activeConds} pb`}
          sub={lastCheck
            ? `Vu il y a ${shortAgo(lastCheck)}`
            : 'Jamais vu'}
          tone={activeConds > 0 ? 'warn' : lastCheck && (Date.now() - lastCheck) < 7 * 86_400_000 ? 'good' : 'neutral'}
          subClassName={freshnessColor(lastCheck)}
        />
      </div>

      {/* Rappels actifs */}
      {due && (
        <div className="px-4 pb-2 -mt-1">
          <p className="text-[11px] text-forest font-semibold flex items-center gap-1">
            ⏰ {due.label} <span className="text-muted font-normal">· {new Date(due.ts).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}</span>
          </p>
        </div>
      )}

      {/* Actions rapides */}
      {!isTemp && (
        <div className="flex gap-2 px-3 pb-3">
          <button
            onClick={onMarkHealthy}
            disabled={busyHealth}
            className="flex-1 py-2.5 rounded-xl bg-meadow text-white text-xs font-bold flex items-center justify-center gap-1.5 active:scale-95 transition-transform disabled:opacity-40"
          >
            <Check size={14} /> {busyHealth ? '…' : 'Vu en bonne santé'}
          </button>
          <button
            onClick={onAddPhoto}
            className="flex-1 py-2.5 rounded-xl bg-cream text-charcoal border border-border text-xs font-bold flex items-center justify-center gap-1.5 active:scale-95 transition-transform"
          >
            <Camera size={14} /> Photo
          </button>
        </div>
      )}
      {checker && lastCheck && (
        <p className="text-[10px] text-muted text-center pb-2 -mt-1">
          Dernier check : {checker} · {new Date(lastCheck).toLocaleDateString('fr-FR')}
        </p>
      )}
    </div>
  )
}

function StatTile({
  label, value, sub, tone, subClassName,
}: {
  label: string
  value: string
  sub: string
  tone: 'good' | 'warn' | 'neutral'
  subClassName?: string
}) {
  const valueColor = tone === 'good' ? 'text-meadow' : tone === 'warn' ? 'text-sun' : 'text-charcoal'
  return (
    <div className="bg-card rounded-xl p-2 border border-border/40 text-center">
      <p className="text-[9px] text-muted uppercase tracking-wider m-0">{label}</p>
      <p className={`text-base font-bold m-0 ${valueColor}`}>{value}</p>
      <p className={`text-[9px] m-0 leading-tight ${subClassName ?? 'text-muted'}`}>{sub}</p>
    </div>
  )
}

function ecsLabel(score?: number, scale?: '1-5' | '1-9'): string {
  if (!score) return '—'
  if (scale === '1-9') {
    if (score <= 3) return 'maigre'
    if (score <= 6) return 'idéal'
    return 'gras'
  }
  if (score <= 2) return 'maigre'
  if (score === 3) return 'idéal'
  return 'gras'
}
function ecsTone(score?: number, scale?: '1-5' | '1-9'): 'good' | 'warn' | 'neutral' {
  if (!score) return 'neutral'
  if (scale === '1-9') return (score >= 4 && score <= 6) ? 'good' : 'warn'
  return score === 3 ? 'good' : 'warn'
}

function IdChip({ label, value }: { label: string; value: string }) {
  function copy() {
    navigator.clipboard?.writeText(value).catch(() => {})
  }
  return (
    <button onClick={copy}
            title="Copier"
            className="bg-white/80 border border-border rounded-md px-1.5 py-0.5 text-[9px] font-mono text-charcoal active:bg-meadow/10 flex items-center gap-1">
      <span className="font-bold text-muted">{label}</span>
      <span className="font-semibold">{value}</span>
      <span className="text-muted text-[8px]">📋</span>
    </button>
  )
}

function shortAgo(ts: number): string {
  const days = (Date.now() - ts) / 86_400_000
  if (days < 1) return "moins d'1 j"
  if (days < 30) return `${Math.round(days)} j`
  if (days < 365) return `${Math.round(days / 30)} mois`
  return `${Math.round(days / 365)} an${days >= 730 ? 's' : ''}`
}
