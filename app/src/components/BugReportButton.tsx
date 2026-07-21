import { useEffect, useRef, useState } from 'react'
import { Bug, Mic, MicOff, X, Send, AlertCircle, Loader2 } from 'lucide-react'
import { reportBug, onAutoReport, getQueueLength } from '../services/bugReporter'

/* ─── Ouverture de la modale depuis l'extérieur ───
 * La bulle 🐞 flottante et draggable a été SUPPRIMÉE le 21/07/2026 (demande de
 * Nils). Elle n'était pas seulement encombrante : posée en bas à droite en
 * z-[9000], elle recouvrait le bouton « + » de la carte (z-[1000]) sur ~36 px,
 * donc un tap pour ajouter une épingle ouvrait la modale de bug à la place.
 *
 * Ce composant reste monté globalement dans App.tsx car il héberge la modale de
 * signalement ET le toast d'auto-capture. Il n'a simplement plus de déclencheur
 * visuel à lui : on l'ouvre depuis Réglages via openBugReport().
 *
 * ⚠️ Ne PAS remettre de bouton fixe en bas à droite sans vérifier la colonne de
 * FAB de la carte (Map.tsx, `absolute bottom-6 right-4`).
 */
type Opener = () => void
const openers = new Set<Opener>()

/** Ouvre la modale « Signaler un bug » depuis n'importe où dans l'app. */
export function openBugReport() {
  openers.forEach(fn => fn())
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

  // S'enregistre comme ouvreur de la modale (appelé par openBugReport()).
  // Add/delete symétriques : sûr avec le double-montage de React StrictMode.
  useEffect(() => {
    const fn = () => setOpen(true)
    openers.add(fn)
    return () => { openers.delete(fn) }
  }, [])

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

      {/* Plus de bouton flottant ici — voir le commentaire en tête de fichier.
          Le compteur de rapports en file est repris dans la modale (plus bas). */}

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
