import { useEffect, useState } from 'react'
import { CheckCircle2 } from 'lucide-react'

/**
 * Confirmation visuelle "tâche validée", volontairement IMPOSSIBLE à manquer.
 *
 * Bug Nils V7 (×3) : les animations de validation ne se voyaient jamais —
 *   1. la tâche quittait sa liste instantanément (élément démonté avant la fin) ;
 *   2. le réglage Android "réduire les animations" tuait toute animation CSS.
 *
 * Solution : un badge plein écran piloté par l'ÉTAT (affiché 1 s puis retiré),
 * donc visible même si le navigateur ignore les animations. Le petit "pop" CSS
 * n'est qu'un bonus — il N'est PAS désactivé par prefers-reduced-motion ici, car
 * c'est précisément ce que l'utilisateur a demandé.
 *
 * Usage : <TaskDoneFlash trigger={compteur} /> — incrémenter `trigger` déclenche
 * l'affichage. Le 0 initial n'affiche rien.
 */
export default function TaskDoneFlash({ trigger }: { trigger: number }) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (trigger === 0) return
    setVisible(true)
    const t = setTimeout(() => setVisible(false), 1000)
    return () => clearTimeout(t)
  }, [trigger])

  if (!visible) return null

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center pointer-events-none">
      <div className="task-done-pop flex flex-col items-center gap-2 bg-forest text-white rounded-3xl px-8 py-6 shadow-2xl">
        <CheckCircle2 size={56} strokeWidth={2.5} />
        <span className="text-base font-extrabold tracking-wide">Validé !</span>
      </div>
    </div>
  )
}
