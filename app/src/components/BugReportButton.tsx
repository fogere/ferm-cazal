import { useCallback, useEffect, useRef, useState } from 'react'
import { Bug, Mic, MicOff, X, Send, AlertCircle, Loader2 } from 'lucide-react'
import { reportBug, onAutoReport, getQueueLength } from '../services/bugReporter'

/* ─── Drag-and-drop du bouton flottant ─── */
const BUTTON_SIZE = 48 // matches w-12 h-12
const DRAG_THRESHOLD_PX = 5
const POS_KEY = 'fm_bug_btn_pos'

interface Pos { x: number; y: number }

function loadSavedPos(): Pos | null {
  try {
    const raw = localStorage.getItem(POS_KEY)
    if (!raw) return null
    const p = JSON.parse(raw)
    if (typeof p?.x === 'number' && typeof p?.y === 'number') return p
  } catch { /* ignoré */ }
  return null
}

function clampToViewport(p: Pos): Pos {
  if (typeof window === 'undefined') return p
  const margin = 4
  return {
    x: Math.max(margin, Math.min(p.x, window.innerWidth  - BUTTON_SIZE - margin)),
    y: Math.max(margin, Math.min(p.y, window.innerHeight - BUTTON_SIZE - margin)),
  }
}

function defaultPos(): Pos {
  if (typeof window === 'undefined') return { x: 16, y: 100 }
  // Coin bas-droit, au-dessus de la bottom nav (~64 px) + safe area
  const safeBottom = 64 + 12
  return {
    x: window.innerWidth  - BUTTON_SIZE - 16,
    y: window.innerHeight - BUTTON_SIZE - safeBottom,
  }
}

/* Types pour Web Speech API (non inclus dans lib.dom standard) */
interface SpeechRecognitionEventLike {
  results: ArrayLike<{
    isFinal: boolean
    0: { transcript: string }
  }>
  resultIndex: number
}
interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null
  onerror:  ((ev: { error: string }) => void) | null
  onend:    (() => void) | null
  start: () => void
  stop:  () => void
  abort: () => void
}
interface SpeechRecognitionCtor { new(): SpeechRecognitionLike }

declare global {
  interface Window {
    SpeechRecognition?:       SpeechRecognitionCtor
    webkitSpeechRecognition?: SpeechRecognitionCtor
  }
}

function getSpeechRecognition(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null
}

export default function BugReportButton() {
  const [open,         setOpen]         = useState(false)
  const [text,         setText]         = useState('')
  const [listening,    setListening]    = useState(false)
  const [sending,      setSending]      = useState(false)
  const [sent,         setSent]         = useState(false)
  const [error,        setError]        = useState<string | null>(null)
  const [autoToast,    setAutoToast]    = useState<string | null>(null)
  const [queueLen,     setQueueLen]     = useState(0)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  // Garde le texte "finalisé" séparément du texte interim pour ne pas dupliquer
  const finalTextRef   = useRef<string>('')

  /* ─── Drag-and-drop state ─── */
  const [pos, setPos] = useState<Pos>(() => clampToViewport(loadSavedPos() ?? defaultPos()))
  const [dragging, setDragging] = useState(false)
  const dragStateRef = useRef<{
    startX: number; startY: number
    posX: number; posY: number
    movedFar: boolean
  } | null>(null)

  // Si on redimensionne, on garde le bouton dans l'écran
  useEffect(() => {
    function onResize() { setPos(p => clampToViewport(p)) }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    // On laisse les clics sur le badge / le bouton fonctionner normalement
    // tant que le doigt n'a pas franchi le seuil DRAG_THRESHOLD_PX.
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    dragStateRef.current = {
      startX: e.clientX, startY: e.clientY,
      posX:   pos.x,     posY:   pos.y,
      movedFar: false,
    }
  }, [pos.x, pos.y])

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    const s = dragStateRef.current
    if (!s) return
    const dx = e.clientX - s.startX
    const dy = e.clientY - s.startY
    if (!s.movedFar && Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) {
      s.movedFar = true
      setDragging(true)
    }
    if (s.movedFar) {
      setPos(clampToViewport({ x: s.posX + dx, y: s.posY + dy }))
    }
  }, [])

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    const s = dragStateRef.current
    dragStateRef.current = null
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId) } catch { /* ignoré */ }
    if (s?.movedFar) {
      // Drag terminé : on sauvegarde la position et on consomme l'event
      try { localStorage.setItem(POS_KEY, JSON.stringify(pos)) } catch { /* ignoré */ }
      setDragging(false)
      e.preventDefault()
      // Empêche le onClick qui suivrait sur certains navigateurs
      e.stopPropagation()
    } else {
      // Vrai clic : ouvre le modal
      setOpen(true)
    }
  }, [pos])

  const SR = getSpeechRecognition()
  const voiceAvailable = SR !== null

  // S'abonne aux auto-reports pour afficher un toast discret
  useEffect(() => {
    const unsub = onAutoReport((desc) => {
      setAutoToast(desc)
      setQueueLen(getQueueLength())
      setTimeout(() => setAutoToast(null), 4500)
    })
    setQueueLen(getQueueLength())
    return unsub
  }, [])

  function startListening() {
    if (!SR) return
    setError(null)
    const rec = new SR()
    rec.lang = 'fr-FR'
    rec.continuous = true
    rec.interimResults = true
    rec.onresult = (ev) => {
      // On accumule uniquement les résultats finaux, et on remplace le texte
      // interim courant par les non-finaux pour une UX de transcription live.
      let interim = ''
      let finalChunk = ''
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i]
        if (r.isFinal) finalChunk += r[0].transcript
        else            interim    += r[0].transcript
      }
      if (finalChunk) {
        finalTextRef.current = (finalTextRef.current + ' ' + finalChunk).trim()
      }
      const combined = (finalTextRef.current + ' ' + interim).trim()
      setText(combined)
    }
    rec.onerror = (ev) => {
      setError(`Erreur micro : ${ev.error}`)
      setListening(false)
    }
    rec.onend = () => {
      setListening(false)
    }
    recognitionRef.current = rec
    finalTextRef.current = text  // permet de continuer si on a déjà tapé du texte
    try { rec.start(); setListening(true) }
    catch { setError("Impossible de démarrer le micro"); setListening(false) }
  }

  function stopListening() {
    try { recognitionRef.current?.stop() } catch { /* ignoré */ }
    setListening(false)
  }

  function closeModal() {
    stopListening()
    setOpen(false)
    setText('')
    setSent(false)
    setError(null)
    finalTextRef.current = ''
  }

  async function submit() {
    const trimmed = text.trim()
    if (!trimmed) {
      setError('Décris brièvement le problème (vocal ou texte).')
      return
    }
    stopListening()
    setSending(true)
    setError(null)
    try {
      await reportBug(trimmed, { source: 'manual' })
      setSent(true)
      setQueueLen(getQueueLength())
      setTimeout(() => closeModal(), 1800)
    } catch {
      // reportBug est `async`, il met en file localStorage s'il échoue donc ne throw pas.
      // Cette branche couvre les cas inattendus.
      setError("Envoi impossible — le rapport a été sauvegardé localement et sera renvoyé plus tard.")
      setQueueLen(getQueueLength())
    } finally {
      setSending(false)
    }
  }

  return (
    <>
      {/* Toast d'auto-capture */}
      {autoToast && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-[9998] max-w-[90vw]">
          <div className="bg-charcoal/95 backdrop-blur-sm text-white text-sm rounded-2xl px-4 py-2.5 shadow-2xl flex items-center gap-2 toast-enter">
            <AlertCircle size={16} className="text-sun flex-shrink-0" />
            <span>{autoToast}</span>
          </div>
        </div>
      )}

      {/* Bouton flottant draggable */}
      {!open && (
        <button
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          aria-label="Signaler un bug (glisser pour déplacer)"
          className={`fixed z-[9000] w-12 h-12 rounded-full bg-danger text-white
                      shadow-2xl flex items-center justify-center select-none
                      ${dragging ? 'scale-110 cursor-grabbing' : 'cursor-grab active:scale-90 transition-all'}`}
          style={{
            left: `${pos.x}px`,
            top:  `${pos.y}px`,
            touchAction: 'none', // bloque le scroll iOS/Android pendant le drag
          }}
        >
          <Bug size={20} />
          {queueLen > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full
                             bg-sun text-earth text-[10px] font-bold flex items-center justify-center
                             ring-2 ring-card">
              {queueLen > 9 ? '9+' : queueLen}
            </span>
          )}
        </button>
      )}

      {/* Modal */}
      {open && (
        <div className="fixed inset-0 z-[9001] flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={closeModal} />
          <div className="relative w-full sm:max-w-md bg-card rounded-t-3xl sm:rounded-3xl shadow-2xl
                          p-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Bug size={20} className="text-danger" />
                <h2 className="text-charcoal text-lg font-bold m-0">Signaler un bug</h2>
              </div>
              <button onClick={closeModal} className="p-2 rounded-xl text-muted active:bg-cream">
                <X size={20} />
              </button>
            </div>

            <p className="text-xs text-muted mb-4 leading-relaxed">
              Explique vocalement ou par écrit ce qui s'est passé. L'historique technique
              (console, navigation, dernières actions) est joint automatiquement.
            </p>

            {/* Boutons micro */}
            {voiceAvailable && (
              <div className="mb-3 flex gap-2">
                {!listening ? (
                  <button
                    onClick={startListening}
                    disabled={sending || sent}
                    className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl
                               border-2 border-forest/30 bg-forest/5 text-forest text-sm font-semibold
                               active:scale-95 transition-all disabled:opacity-40"
                  >
                    <Mic size={18} /> Parler
                  </button>
                ) : (
                  <button
                    onClick={stopListening}
                    className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl
                               bg-danger text-white text-sm font-bold active:scale-95 transition-all
                               animate-pulse"
                  >
                    <MicOff size={18} /> Stop ({Math.round((finalTextRef.current.length || text.length) / 5)} mots)
                  </button>
                )}
              </div>
            )}

            {/* Textarea */}
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={voiceAvailable
                ? "Ce qui ne marche pas… (ou clique sur Parler)"
                : "Ce qui ne marche pas…"}
              disabled={sending || sent}
              rows={6}
              className="w-full px-4 py-3 rounded-xl border border-border bg-cream text-charcoal text-sm
                         focus:outline-none focus:ring-2 focus:ring-forest transition-all resize-none
                         disabled:opacity-60"
            />

            {!voiceAvailable && (
              <p className="text-xs text-muted/70 mt-2">
                Saisie vocale indisponible sur ce navigateur (texte uniquement).
              </p>
            )}

            {error && (
              <div className="mt-3 bg-danger/10 border border-danger/30 rounded-xl px-3 py-2 text-xs text-danger">
                {error}
              </div>
            )}

            {sent && (
              <div className="mt-3 bg-meadow/10 border border-meadow/30 rounded-xl px-3 py-2 text-xs text-meadow font-semibold">
                ✓ Rapport envoyé. Merci.
              </div>
            )}

            <div className="mt-4 flex gap-2">
              <button
                onClick={closeModal}
                disabled={sending}
                className="flex-1 py-3 rounded-xl border border-border text-muted text-sm font-semibold
                           active:bg-cream transition-colors disabled:opacity-40"
              >
                Annuler
              </button>
              <button
                onClick={submit}
                disabled={sending || sent || !text.trim()}
                className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-forest text-white
                           text-sm font-bold active:scale-95 transition-all disabled:opacity-40"
              >
                {sending ? <Loader2 size={16} className="animate-spin" />
                  : sent ? '✓' : <><Send size={16} /> Envoyer</>}
              </button>
            </div>

            {queueLen > 0 && (
              <p className="text-[11px] text-muted/70 mt-3 text-center">
                {queueLen} rapport(s) en file locale, renvoi automatique au prochain envoi réussi.
              </p>
            )}
          </div>
        </div>
      )}
    </>
  )
}
