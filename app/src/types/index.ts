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
  // Heure à laquelle le user veut recevoir le résumé du matin (HH:MM Europe/Paris).
  // Défaut implicite : valeur de silentEnd, sinon 07:00.
  morningReminderTime?: string
  // Timestamp de l'ouverture de la carte (heartbeat 60 s). Sert au modèle
  // pull-on-demand : tant qu'un user a `mapOpenAt` récent, les autres
  // publient leur position 1× pour qu'il les voie ; sinon, plus aucune
  // écriture liveLocation côté Firestore. Effacé proprement au unmount.
  mapOpenAt?:    number
  // Anti-spam geofence : timestamp de la dernière notification "tu es dans
  // l'enclos X" envoyée à cet utilisateur, par id d'enclos.
  geofenceNotified?: Record<string, number>
}

export interface Task {
  id: string
  title: string
  zone: string
  // Pool model : si null, personne ne s'en occupe (tâche libre).
  // Quand quelqu'un clique "Je m'en occupe", on met son uid.
  // Conservé en string pour la rétrocompat (anciennes tâches "auto" / uid).
  assignedTo: string | null
  // Quand a-t-elle été prise (timestamp ms). Permet d'afficher "depuis 2h".
  claimedAt?: number | null
  recurrence: 'once' | 'daily' | 'weekly' | 'every_n_days'
  // Pour 'every_n_days' : intervalle en jours (1-30 par convention).
  intervalDays?: number
  priority: 'normal' | 'urgent'
  completed: boolean
  completedAt?: number | null
  completedBy?: string | null
  createdAt: number
  createdBy: string
  dueDate: number
  nextOccurrenceCreated?: boolean
  // Quand quelqu'un libère en urgence ("je peux plus"), le cron ping tous.
  urgentReleaseAt?: number | null
  urgentReleaseBy?: string | null
  urgentReleaseReason?: string
  urgentNotified?: boolean // flag cron : push déjà envoyé
  // Mode broadcast : tâche notifiée à TOUT LE MONDE à l'heure due (et pas à un
  // seul assigné). N'importe qui peut la marquer "fait" ; reste visible 24 h
  // après pour informer les autres que c'est traité.
  broadcast?: boolean
  // Flag cron : broadcast déjà émis pour cette occurrence (anti-doublon).
  broadcastNotifiedAt?: number | null
  // Si broadcast=true, ces champs gardent qui a coché et quand, pour l'UI 24 h.
  // (Différent de completedBy/At pour les tâches récurrentes : sur une broadcast
  // récurrente on garde l'info de la dernière complétion.)
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

export type PinType = 'water_natural' | 'water_manual' | 'battery' | 'zone' | 'fence' | 'note' | 'alert' | 'todo' | 'water_stream'

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
  // Toggle ON/OFF — bug Nils 21/05/2026 : pouvoir signaler qu'une batterie est éteinte,
  // ce qui rend invisible toutes les clôtures qui lui sont connectées et place un voyant
  // visuel sur le pin batterie. Par défaut (non défini) = ON.
  powerOn?: boolean

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

  // ── todo (point "à faire" sur la carte : arbre mort à couper, clôture à réparer…) ──
  // Demande Eugénie 20/05/2026. Type minimal : un pin 'todo' avec un statut binaire
  // (open / done). La description est dans `name` + `note`. Pas d'assignation pour
  // l'instant (un super-admin peut créer une vraie Task si besoin de notif).
  todoStatus?:      'open' | 'done'
  todoCompletedAt?: number
  todoCompletedBy?: string

  // ── fence : rotation à prévoir ──
  // Demande Eugénie 21/05/2026 : "un bouton pour signaler qu'il faut bientôt
  // changer les animaux de parc". Date prévue de rotation → badge ⏰ sur le parc
  // qui devient orange à J-7 puis rouge à échéance. Effacé une fois la rotation effective.
  rotationDueAt?:   number
  rotationNote?:    string

  // ── fence (électrique) : intensité du courant ──
  // Demande Nils 21/05/2026 : "option d'atténuation du motif électrique pour
  // indiquer son intensité". S'applique uniquement aux fence avec wireStyle='electric'.
  //   full       → opacity normale (par défaut quand non défini)
  //   attenuated → opacité réduite, motif pointillé (signale fin de circuit / courant faible)
  //   off        → opacité 30% + motif rouge (batterie débranchée ou circuit coupé)
  electricityIntensity?: 'full' | 'attenuated' | 'off'
  // Référence à la batterie qui alimente cette clôture. Si la batterie associée a
  // `powerOn === false`, la clôture est rendue comme "off" automatiquement (override
  // de electricityIntensity). Demande Nils 21/05/2026.
  connectedBatteryId?: string

  // ── water_stream (cours d'eau tracé en polyline) ──
  // Demande Eugénie 21/05/2026 (V2) : remplacer water_natural (pin ponctuel) par un
  // vrai tracé linéaire. Phase 1 : tracé + saisonnalité. Phase 2 (à venir) : atténuation
  // manuelle par segment ("à partir de ce point, -90% de débit").
  //
  // `points` (déjà existant pour fence) sert au tracé.
  streamMode?:          'permanent' | 'seasonal'
  // Si seasonal : mois où l'eau coule (1 = janvier, 12 = décembre). Vide = aucun mois actif.
  streamActiveMonths?:  number[]
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

// Identifiant d'espèce : "horse" / "donkey" pour les races par défaut, ou un id
// libre (slug) pour une race personnalisée définie dans config/farm.customSpecies.
export type AnimalSpecies = string

// Race personnalisée (chat, chien, mouton…) avec son emoji et son nom d'affichage.
// Stockée dans config/farm.customSpecies, gérée depuis Admin.
export interface CustomSpecies {
  id:    string  // slug unique, ex: "cat" / "sheep" / "dog"
  name:  string  // libellé affiché, ex: "Chat" / "Mouton"
  emoji: string  // emoji unique, ex: "🐱" / "🐑"
  gestationDays?: number  // pour calcul de mise bas si applicable
}

// Sexe + statut reproductif d'un animal. "gelding" = hongre (mâle castré),
// "mare" = jument. Pour les autres espèces : male/female + flag neutered.
export type AnimalGender = 'male' | 'female' | 'gelding' | 'mare' | 'unknown'

// Condition de santé enregistrée sur un animal : peut être héréditaire (génétique)
// ou contagieuse entre animaux vivants ensemble. La description précise le contexte.
export interface AnimalCondition {
  id:          string   // uuid local
  label:       string   // ex: "Boiterie chronique", "Asthme équin"
  description: string   // contexte détaillé
  isGenetic:   boolean  // transmissible à la descendance
  isContagious: boolean // transmissible aux autres animaux vivants
  permanent:   boolean  // true = problème à vie, false = problème temporaire en cours
  addedAt:     number
  addedBy:     string
  resolvedAt?: number   // si permanent=false et résolu, timestamp de fin
}

export interface Animal {
  id: string
  name: string
  species: AnimalSpecies
  enclosureId: string | null  // ID du map_pin clôture fermée, null = non placé
  addedAt: number
  addedBy: string
  photoUrl?: string           // photo d'identité (data URL JPEG compressée)
  // Dernière fois que quelqu'un a vu l'animal en bonne santé (depuis la carte
  // ou un check sur le terrain). Permet d'afficher en un coup d'œil les bêtes
  // qu'on n'a pas vues depuis longtemps. Mis à jour par tout utilisateur (rules
  // assouplies pour ces 2 champs uniquement).
  lastCheckedHealthy?:    number
  lastCheckedHealthyBy?:  string

  /* ── Fiche détaillée (étendue) ── */
  birthDate?:  number       // timestamp de naissance (jour précis ou estimation)
  birthEstimated?: boolean  // true si la date est approximative
  gender?:     AnimalGender
  neutered?:   boolean      // castré / stérilisé (pour espèces où "gelding" ne s'applique pas)
  sireId?:     string       // id du père (animal du même cheptel) — optionnel
  damId?:      string       // id de la mère — optionnel
  notes?:      string       // note libre (caractère, allergies, particularités…)
  conditions?: AnimalCondition[]

  /* ── Identification administrative (équidés) ── */
  // Numéro SIRE (IFCE) — 8 caractères alphanumériques. Obligatoire pour les équidés
  // français, sert aux contrôles et au passeport.
  sireNumber?: string
  // Numéro de transpondeur (puce électronique sous-cutanée) — 15 chiffres ISO 11784.
  // Obligatoire en France depuis 2008 pour tout équidé identifié.
  transponderId?: string
}

// Photo de suivi d'un animal (évolution dans le temps, blessure qui cicatrise,
// pelage saisonnier, prise de poids, etc.). Une photo = un instant T. La galerie
// permet de comparer dans le temps. Stockage : data URL JPEG compressée (1 MiB max).
export interface AnimalPhoto {
  id:         string
  animalId:   string
  uploadedBy: string
  uploadedAt: number
  takenAt:    number   // date à laquelle la photo a été prise (peut différer de uploadedAt)
  dataUrl:    string
  note?:      string
  // Catégorie pour filtrer la galerie : suivi général, ou suivi d'une condition spécifique.
  category?:  'general' | 'condition'
  conditionId?: string  // si category='condition', lie à AnimalCondition.id
  // Tags libres (ex: 'pelage_hiver', 'apres_tonte', 'boiterie') pour filtrer la galerie
  // et le slideshow comparatif.
  tags?:      string[]
}

// Mesure ponctuelle d'un animal (poids, taille, ECS…). Une saisie = un point sur
// la courbe d'évolution. Permet le vrai "suivi de croissance" demandé par les
// utilisatrices : voir évoluer une jument enceinte, suivre la prise de poids
// d'un poulain, surveiller un chat qui perd du poids.
export interface AnimalMeasurement {
  id:          string
  animalId:    string
  date:        number     // timestamp de la mesure
  weightKg?:   number     // poids (kg)
  withersCm?:  number     // taille au garrot (cm) — pour chevaux/ânes
  girthCm?:    number     // tour de poitrail (cm)
  ecs?:        number     // Body Condition Score (1-5 ou 1-9 selon convention)
  ecsScale?:   '1-5' | '1-9'   // échelle utilisée (défaut '1-5')
  note?:       string
  photoUrl?:   string     // photo optionnelle attachée à cette mesure
  recordedBy:  string
  createdAt:   number
}

export type AnimalCareType =
  | 'vaccine'      // vaccination
  | 'vermifuge'    // vermifugation
  | 'parage'       // parage des sabots / onglons
  | 'vet_visit'    // visite vétérinaire
  | 'medication'   // traitement / soin
  | 'breeding'     // saillie (auto-calcule date prévue de mise bas : +340 j)
  | 'birth'        // mise bas / poulinage
  | 'food'         // croquettes / nourriture (animaux domestiques : chat, chien…)
  | 'grooming'     // toilettage (tonte, brossage, taille des griffes…)
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
  // Récurrence automatique : si défini, intervalle en jours entre 2 occurrences.
  // Quand un soin avec recurrenceDays est créé, nextDueAt est auto-calculé à
  // date + recurrenceDays ; et quand l'utilisateur "marque fait" la prochaine
  // échéance (= crée la nouvelle entrée), la récurrence est chaînée.
  recurrenceDays?: number
}

// Message ciblé envoyé d'un utilisateur (super-admin) à un autre. Sert principalement
// à répondre à un bug report : la réponse reste persistée dans /messages et le destinataire
// peut la relire autant de fois qu'il veut. Pas de FCM (le cron natif s'en charge si besoin),
// juste un badge in-app sur le Dashboard + la liste sur /messages.
export interface UserMessage {
  id: string
  toUid: string            // destinataire
  toUidName?: string       // pour debug (displayName au moment de l'envoi)
  fromUid: string          // expéditeur
  fromUidName?: string     // affiché dans la liste (pour ne pas refetch les profils)
  title: string            // 80 chars max suggérés
  body: string             // texte libre, peut contenir des retours ligne
  relatedBugId?: string    // référence au bugReports d'origine (optionnel)
  createdAt: number
  readAt?: number | null   // null = pas encore lu ; sinon timestamp de première ouverture
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
  // Date RÉELLE du déplacement (peut être saisie rétroactivement pour reconstituer
  // un calendrier de pâturage PAC). Pour les anciens mouvements sans
  // `recordedAt`, c'est la date de saisie qui était stockée ici.
  movedAt: number
  movedBy: string  // uid
  // Date de saisie dans l'app (immutable). Permet de distinguer une saisie
  // rétroactive d'un mouvement temps réel.
  recordedAt?: number
  // Note libre (ex: "rotation pré 1 → pré 2 pour pousse herbe", "transhumance")
  note?: string
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
