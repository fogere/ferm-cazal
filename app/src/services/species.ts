import type { CustomSpecies } from '../types'

// Races par défaut (ferme équine). Toujours dispo sans config Firestore.
export const DEFAULT_SPECIES = {
  horse:  { emoji: '🐎', label: 'Cheval', gestationDays: 340 },
  donkey: { emoji: '🐴', label: 'Âne',    gestationDays: 365 },
} as const

export type DefaultSpeciesId = keyof typeof DEFAULT_SPECIES

export interface SpeciesInfo {
  emoji: string
  label: string
  gestationDays?: number
}

// Retourne l'emoji + label pour une espèce, en cherchant d'abord dans les
// races par défaut puis dans la liste custom passée en argument. Fallback
// pattes 🐾 + libellé brut si introuvable (cas d'une race supprimée mais
// encore référencée par un vieil animal).
export function getSpeciesInfo(
  species: string,
  customList: CustomSpecies[] = [],
): SpeciesInfo {
  if (species === 'horse')  return DEFAULT_SPECIES.horse
  if (species === 'donkey') return DEFAULT_SPECIES.donkey
  const custom = customList.find(c => c.id === species)
  if (custom) {
    return {
      emoji: custom.emoji,
      label: custom.name,
      gestationDays: custom.gestationDays,
    }
  }
  return { emoji: '🐾', label: species }
}

// Liste fusionnée par défaut + custom, pour les UI de choix d'espèce.
export function listAllSpecies(customList: CustomSpecies[] = []): Array<{ id: string } & SpeciesInfo> {
  return [
    { id: 'horse',  ...DEFAULT_SPECIES.horse },
    { id: 'donkey', ...DEFAULT_SPECIES.donkey },
    ...customList.map(c => ({
      id:    c.id,
      emoji: c.emoji,
      label: c.name,
      gestationDays: c.gestationDays,
    })),
  ]
}

// Génère un slug d'id depuis un nom français (pour création d'une race custom).
// "Chat angora" → "chat-angora", supprime les accents.
export function slugifySpecies(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
}
