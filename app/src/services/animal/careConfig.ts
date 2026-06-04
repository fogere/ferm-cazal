// Source unique de vérité pour la configuration des types de soins du carnet
// de santé (animal_care). Avant ce fichier, cette config était dupliquée à 3
// endroits (Admin.tsx, AnimalDetail.tsx, AnimalTimeline.tsx) et divergeait.
// Toute UI qui affiche un soin DOIT importer CARE_CFG depuis ici — c'est ce qui
// garantit que le carnet est identique partout (carte, fiche animal, admin).

import type { AnimalCareType } from '../../types'

export interface CareTypeCfg {
  icon:  string
  label: string
  color: string   // classe Tailwind de couleur du texte
}

export const CARE_CFG: Record<AnimalCareType, CareTypeCfg> = {
  vaccine:    { icon: '💉', label: 'Vaccin',     color: 'text-sky' },
  vermifuge:  { icon: '💊', label: 'Vermifuge',  color: 'text-meadow' },
  parage:     { icon: '🐴', label: 'Parage',     color: 'text-earth' },
  vet_visit:  { icon: '🩺', label: 'Visite véto', color: 'text-forest' },
  medication: { icon: '🧪', label: 'Soin',       color: 'text-orange-600' },
  breeding:   { icon: '💕', label: 'Saillie',    color: 'text-pink-600' },
  birth:      { icon: '🐣', label: 'Mise bas',   color: 'text-meadow' },
  food:       { icon: '🥣', label: 'Croquettes', color: 'text-orange-600' },
  grooming:   { icon: '✂️', label: 'Toilettage', color: 'text-sky' },
  other:      { icon: '📝', label: 'Autre',       color: 'text-muted' },
}

// Ordre d'affichage stable du sélecteur de type (dans le formulaire « Nouveau soin »).
export const CARE_TYPE_ORDER: AnimalCareType[] = [
  'vaccine', 'vermifuge', 'parage', 'vet_visit', 'medication',
  'breeding', 'birth', 'food', 'grooming', 'other',
]

// Accès tolérant : un type inconnu (donnée legacy) retombe sur « Autre ».
export function careCfg(type: AnimalCareType): CareTypeCfg {
  return CARE_CFG[type] ?? CARE_CFG.other
}
