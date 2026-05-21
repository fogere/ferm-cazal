// Composants visuels partagés entre les sous-panneaux de la carte
// (FencePanel, BatteryPanel, WaterStreamPanel, etc.). Extraits de Map.tsx
// lors de la refacto S1 du plan refonte clôtures/espaces.

/**
 * Ligne label + valeur, format standard du panneau de détail d'un pin.
 * Auparavant défini en local dans Map.tsx.
 */
export function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center text-sm">
      <span className="text-muted">{label}</span>
      <span className="text-charcoal font-medium">{value}</span>
    </div>
  )
}

// Configuration visuelle des statuts batterie. Partagé entre BatteryPanel
// (édition d'une batterie) et le formulaire de création (Map.tsx).
export const BATTERY_STATUS_CFG = {
  good:     { label: 'Bon',        color: 'text-meadow',     bg: 'bg-meadow/10   border-meadow/30'  },
  warning:  { label: 'Attention',  color: 'text-sun',        bg: 'bg-sun/10      border-sun/30'     },
  critical: { label: 'Critique',   color: 'text-orange-600', bg: 'bg-orange-500/10 border-orange-500/30' },
  replace:  { label: 'À changer', color: 'text-danger',     bg: 'bg-danger/10   border-danger/30'  },
  down:     { label: 'En panne',   color: 'text-danger',     bg: 'bg-danger/15   border-danger/40'  },
} as const
