// Sélecteur d'emoji intégré à l'app. Nils 11/06/2026 : le sélecteur d'emoji de
// Windows n'insère pas dans nos <input>, donc on fournit notre propre grille
// catégorisée + recherche. Aucune dépendance externe (cf. règle projet : pas de
// lib si on peut faire simple). Overlay plein écran, au-dessus du formulaire pin.

import { useMemo, useState } from 'react'
import { X, Search } from 'lucide-react'

// Catégories d'emojis. Liste volontairement large mais maintenable à la main —
// couvre les repères de terrain utiles à la ferme + un fond généraliste.
const CATEGORIES: { key: string; label: string; emojis: string[] }[] = [
  {
    key: 'reperes', label: '📍 Repères',
    emojis: ['📌','📍','⭐','❗','‼️','⚠️','🚧','🛑','🚩','🏁','🎯','🔺','🔻','🔴','🟠','🟡','🟢','🔵','🟣','⚫','⚪','🟤','💠','♦️','🔶','🔷'],
  },
  {
    key: 'nature', label: '🌳 Nature',
    emojis: ['🌳','🌲','🌴','🌵','🌿','🍀','🍂','🍄','🪨','🪵','🌾','🌱','🪴','🏔️','⛰️','🌋','🏕️','🏞️','🌊','💧','🔥','❄️','🌧️','⚡','🌳','🦠'],
  },
  {
    key: 'animaux', label: '🐴 Animaux',
    emojis: ['🐴','🐎','🫏','🐐','🐑','🐂','🐄','🐖','🐓','🐔','🐣','🐦','🦅','🦉','🐈','🐕','🐇','🦊','🐺','🐗','🦌','🐍','🦔','🐝','🕷️','🐞'],
  },
  {
    key: 'outils', label: '🔧 Outils & objets',
    emojis: ['🔧','🔨','🪛','🪚','⛏️','🪓','🔩','⚙️','🧰','🪜','🔑','🔒','🔓','🧲','🔋','🔌','💡','🔦','🪣','🧯','⛓️','🪤','🧪','💉','💊','🩹','📦','🗑️','🚜','🚗','🛻','🏍️'],
  },
  {
    key: 'lieux', label: '🏠 Lieux',
    emojis: ['🏠','🏡','🏚️','🏭','⛺','🏕️','🚪','🚧','🌉','⛩️','🏛️','🚰','⛲','🅿️','🚏','🛖','🏗️','🧱','🪟','🚽'],
  },
  {
    key: 'symboles', label: '✅ Symboles',
    emojis: ['✅','❌','➕','➖','❓','❔','♻️','⚡','☀️','🌙','⭐','💀','☠️','👻','🆘','🔆','♨️','🚱','🚳','🔞','💢','💥','💦','🕳️','👁️','💀'],
  },
  {
    key: 'visages', label: '😀 Visages',
    emojis: ['😀','😅','😂','🙂','😉','😍','😎','🤔','😴','😱','😡','🥶','🥵','🤢','🤕','👍','👎','👌','✊','🙏','💪','👀','🧠','❤️','💚','💙','💛','🧡','💜'],
  },
]

interface Props {
  onPick:  (emoji: string) => void
  onClose: () => void
}

export default function EmojiPicker({ onPick, onClose }: Props) {
  const [q, setQ] = useState('')

  // Recherche très simple : si la requête est un emoji collé, on le propose direct ;
  // sinon on filtre par présence (pas de noms en français pour rester léger), donc
  // on montre tout sauf si l'utilisateur a tapé un emoji.
  const pastedEmoji = useMemo(() => {
    const chars = Array.from(q.trim())
    const last = chars[chars.length - 1]
    // Heuristique : un "emoji" n'est pas un caractère ASCII basique.
    return last && last.codePointAt(0)! > 0x2000 ? last : null
  }, [q])

  return (
    <div className="fixed inset-0 z-[2700] bg-black/50 flex items-end sm:items-center justify-center p-3"
         onClick={onClose}>
      <div className="bg-card w-full max-w-md rounded-3xl shadow-xl overflow-hidden flex flex-col max-h-[80vh]"
           onClick={e => e.stopPropagation()}>
        <div className="px-5 pt-4 pb-3 flex items-center justify-between border-b border-border/40">
          <p className="text-sm font-bold text-charcoal">Choisir un emoji</p>
          <button onClick={onClose} className="w-8 h-8 rounded-lg bg-cream flex items-center justify-center active:scale-95">
            <X size={16} className="text-muted" />
          </button>
        </div>

        {/* Champ : coller son propre emoji (pour ceux du clavier non listés) */}
        <div className="px-5 py-3 border-b border-border/40">
          <div className="flex items-center gap-2 bg-cream rounded-xl px-3 py-2">
            <Search size={15} className="text-muted flex-shrink-0" />
            <input
              type="text"
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Colle ici n'importe quel emoji du clavier…"
              className="flex-1 bg-transparent outline-none text-base text-charcoal min-w-0"
            />
            {pastedEmoji && (
              <button
                onClick={() => { onPick(pastedEmoji); onClose() }}
                className="px-3 py-1 rounded-lg bg-forest text-white text-sm font-bold active:opacity-90 flex items-center gap-1"
              >
                <span className="text-lg leading-none">{pastedEmoji}</span> OK
              </button>
            )}
          </div>
        </div>

        <div className="px-4 py-3 overflow-y-auto">
          {CATEGORIES.map(cat => (
            <div key={cat.key} className="mb-3">
              <p className="text-[11px] font-semibold text-muted uppercase tracking-wider mb-1.5 px-1">{cat.label}</p>
              <div className="grid grid-cols-8 gap-1">
                {cat.emojis.map((em, i) => (
                  <button
                    key={`${cat.key}-${i}`}
                    type="button"
                    onClick={() => { onPick(em); onClose() }}
                    className="py-2 rounded-lg text-xl active:bg-cream transition-colors"
                  >
                    {em}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
