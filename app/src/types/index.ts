export type Availability = 'available' | 'limited' | 'unavailable'

export interface UserProfile {
  uid: string
  displayName: string
  color: string
  silentStart: string
  silentEnd: string
  fcmToken?: string
  availability: Availability
  availabilityDate: string
  // Partage de position (opt-in)
  shareLocation?: boolean
  liveLocation?: { lat: number; lng: number; accuracy: number; updatedAt: number }
  // Pointeur temps réel (curseur partagé sur la carte)
  livePointer?:  { lat: number; lng: number; updatedAt: number }
}

export interface Task {
  id: string
  title: string
  zone: string
  assignedTo: string
  recurrence: 'once' | 'daily' | 'weekly'
  priority: 'normal' | 'urgent'
  completed: boolean
  completedAt?: number | null
  completedBy?: string | null
  createdAt: number
  createdBy: string
  dueDate: number
  nextOccurrenceCreated?: boolean
}

export type WaterPointType = 'natural' | 'manual'
export type AvailabilityMode = 'always' | 'seasonal' | 'conditional'
export type StatusLevel = 'ok' | 'warning' | 'problem' | 'inactive'

export interface WaterPointBase {
  id: string
  name: string
  type: WaterPointType
  lat: number
  lng: number
  status: StatusLevel
  animals: string[]
  note: string
  updatedAt: number
  updatedBy: string
}

export interface WaterPointNatural extends WaterPointBase {
  type: 'natural'
  availabilityMode: AvailabilityMode
  activeMonths: number[]
}

export interface WaterPointManual extends WaterPointBase {
  type: 'manual'
  intervalHours: number
  lastFilled: number
  lastFilledBy: string
  alertBeforeHours: number
  escalateAfterHours: number
  assignedTo: string
}

export type WaterPoint = WaterPointNatural | WaterPointManual

export type BatteryStatus = 'good' | 'warning' | 'critical' | 'replace' | 'down'

export interface Battery {
  id: string
  name: string
  lat: number
  lng: number
  status: BatteryStatus
  lastChecked: number
  lastCheckedBy: string
  checkIntervalDays: number
  note: string
}

export type PinType = 'water_natural' | 'water_manual' | 'battery' | 'zone' | 'fence' | 'note' | 'alert'

export interface MapPin {
  id: string
  name: string
  type: PinType
  lat: number
  lng: number
  status: StatusLevel
  note: string
  createdAt: number
  createdBy: string
  updatedAt: number
  updatedBy?: string
  refId?: string

  // ── water_manual ──
  intervalHours?: number
  alertBeforeHours?: number
  lastFilled?: number | null
  dueAt?: number
  nextReminderAt?: number
  reminderSent?: boolean
  assignedTo?: string
  escalateAfterHours?: number
  lastEscalatedAt?: number

  // ── water_natural ──
  availabilityMode?: 'always' | 'seasonal' | 'conditional'
  activeMonths?: number[]
  waterStatus?: 'functional' | 'problem' | 'dry' | 'frozen'
  waterAnimals?: string[]

  // ── battery ──
  batteryStatus?: 'good' | 'warning' | 'critical' | 'replace' | 'down'
  lastChecked?: number
  lastCheckedBy?: string
  checkIntervalDays?: number
  zoneCovered?: string
  nextCheckAt?: number

  // ── zone ──
  currentOccupants?: string[]
  occupiedSince?: number
  rotationHistory?: { occupants: string[]; from: number; to?: number }[]

  // ── fence (polyline / polygon) ──
  points?: { lat: number; lng: number }[]
  presetId?: string
  presetColor?: string
  wireCount?: number
  wireVoltage?: number
  closed?: boolean  // true = polygon fermé (enclos)
  fillOnly?: boolean // true = enclos découpé : garder le fill + animaux, le contour est géré par des segments séparés
  cutFromId?: string // ID du fence parent dont ce segment provient (lié à une coupe ciseau)
  photoCount?: number // nombre de photos attachées (maintenu via uploadPinPhoto / deletePinPhoto)
}

export interface FencePreset {
  id: string
  name: string
  color: string
  description: string
  wireStyle: 'electric' | 'barbed' | 'ribbon' | 'plain'
  createdBy: string
  createdAt: number
}

export interface AnimalZone {
  id: string
  name: string
  lat: number
  lng: number
  currentOccupants: string[]
  occupiedSince: number
  linkedBatteryId?: string
  note: string
  rotationHistory: { occupants: string[]; from: number; to?: number }[]
}

export type AlertSeverity = 'info' | 'warning' | 'urgent'

export interface FermeAlert {
  id: string
  type: string
  message: string
  severity: AlertSeverity
  resolved: boolean
  resolvedAt?: number
  resolvedBy?: string
  createdAt: number
  refId?: string
}

export interface TempUser {
  id: string
  displayName: string
  active: boolean
  addedBy: string
  addedAt: number
}

export interface TempAccessCode {
  id: string          // document ID = code normalisé (12 chars sans tirets)
  displayName: string // prénom de l'aide
  expiresAt: number
  createdAt: number
  createdBy: string
}

export interface PinPhoto {
  id: string
  pinId: string         // ID du map_pin associé
  uploadedBy: string    // uid de l'auteur
  uploadedAt: number
  dataUrl: string       // data:image/jpeg;base64,... (compressé client-side)
  note?: string
}

export type AnimalSpecies = 'horse' | 'donkey'

export interface Animal {
  id: string
  name: string
  species: AnimalSpecies
  enclosureId: string | null  // ID du map_pin clôture fermée, null = non placé
  addedAt: number
  addedBy: string
  photoUrl?: string           // photo d'identité (data URL JPEG compressée)
}

export type AnimalCareType =
  | 'vaccine'      // vaccination
  | 'vermifuge'    // vermifugation
  | 'parage'       // parage des sabots / onglons
  | 'vet_visit'    // visite vétérinaire
  | 'medication'   // traitement / soin
  | 'breeding'     // saillie (auto-calcule date prévue de mise bas : +340 j)
  | 'birth'        // mise bas / poulinage
  | 'other'        // autre

export interface AnimalCareEntry {
  id: string
  animalId: string
  type: AnimalCareType
  date: number        // timestamp de réalisation
  note: string
  performedBy: string // uid de la personne qui a saisi
  createdAt: number
  nextDueAt?: number  // optionnel : prochaine échéance (rappel à venir)
}

export interface Reserve {
  id: string
  name: string             // "Foin grange", "Granulés cheval"
  unit: string             // "ballots", "kg", "sacs"
  currentQty: number
  alertThreshold: number   // alerter si currentQty <= seuil
  note?: string
  updatedAt: number
  updatedBy: string
}

export interface EnclosureMovement {
  id: string
  animalId: string
  animalName: string
  species: AnimalSpecies
  fromEnclosureId: string | null
  fromEnclosureName: string | null
  toEnclosureId: string | null
  toEnclosureName: string | null
  movedAt: number
  movedBy: string  // uid
}

export interface WeatherData {
  temperature: number
  windSpeed: number
  windGusts: number
  precipitation: number
  humidity: number
  weatherCode: number
  maxTemp: number
  minTemp: number
}

export type VigilanceLevel = 'Vert' | 'Jaune' | 'Orange' | 'Rouge'
export type FireRiskLevel  = 'Faible' | 'Modéré' | 'Élevé' | 'Très élevé' | null
