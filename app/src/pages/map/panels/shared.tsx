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
