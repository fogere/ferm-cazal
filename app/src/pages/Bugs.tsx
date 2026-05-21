import { useEffect, useMemo, useState } from 'react'
import { addDoc, collection, deleteDoc, doc, onSnapshot, orderBy, query } from 'firebase/firestore'
import { Bug, ChevronDown, ChevronRight, Copy, ExternalLink, Trash2, Download, Trash, Mail, X } from 'lucide-react'
import { db } from '../firebase'
import { useAuth } from '../hooks/useAuth'
import type { ConsoleEntry, ActionEntry } from '../services/bugReporter'

// Super-admins autorisés à répondre aux bugs (même règle que Tasks.tsx).
// Identifiés par leur displayName (en minuscules, sans accents).
const SUPER_ADMIN_NAMES = ['eugenie', 'eugénie', 'benoit', 'benoît']
function normalizeName(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()
}
function isSuperAdmin(name: string | undefined | null): boolean {
  if (!name) return false
  return SUPER_ADMIN_NAMES.includes(normalizeName(name))
}

interface StoredBug {
  id:              string
  source:          'manual' | 'auto'
  description:     string
  errorMessage?:   string
  errorStack?:     string
  reportedBy?:     string
  reportedByName?: string
  consoleEntries?: ConsoleEntry[]
  userActions?:    ActionEntry[]
  url?:            string
  userAgent?:      string
  viewport?:       { w: number; h: number }
  capturedAt?:     number
  // createdAt est un Timestamp serveur ; on en lit la valeur via toMillis si dispo
  createdAt?:      { toMillis?: () => number } | number | null
  replayed?:       boolean
}

// URL GitHub du repo (pour bouton "Ouvrir issue")
const GITHUB_REPO = 'fogere/ferm-cazal'

function tsOf(b: StoredBug): number {
  const c = b.createdAt
  if (typeof c === 'number') return c
  if (c && typeof c.toMillis === 'function') return c.toMillis()
  return b.capturedAt ?? 0
}

function formatTime(ts: number): string {
  if (!ts) return '—'
  const d = new Date(ts)
  return d.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'medium' })
}

function levelColor(l: ConsoleEntry['level']): string {
  switch (l) {
    case 'error': return 'text-danger'
    case 'warn':  return 'text-sun'
    case 'info':  return 'text-sky'
    case 'debug': return 'text-muted/60'
    default:      return 'text-muted'
  }
}

function buildMarkdown(b: StoredBug): string {
  const lines: string[] = []
  lines.push(`# Bug : ${b.description}`)
  lines.push('')
  lines.push(`- **Auteur :** ${b.reportedByName ?? b.reportedBy ?? 'inconnu'}`)
  lines.push(`- **Source :** ${b.source === 'auto' ? '⚠ Auto-capture' : '👤 Manuel'}`)
  lines.push(`- **Date :** ${formatTime(tsOf(b))}`)
  if (b.url)        lines.push(`- **URL :** ${b.url}`)
  if (b.viewport)   lines.push(`- **Viewport :** ${b.viewport.w}×${b.viewport.h}`)
  if (b.userAgent)  lines.push(`- **UA :** \`${b.userAgent}\``)
  lines.push('')
  if (b.errorMessage) {
    lines.push('## Message d\'erreur')
    lines.push('```')
    lines.push(b.errorMessage)
    lines.push('```')
  }
  if (b.errorStack) {
    lines.push('## Stack trace')
    lines.push('```')
    lines.push(b.errorStack)
    lines.push('```')
  }
  if (b.userActions?.length) {
    lines.push('## Actions utilisateur (avant)')
    lines.push('```')
    for (const a of b.userActions) {
      lines.push(`${formatTime(a.ts)}  [${a.kind}]  ${a.label}`)
    }
    lines.push('```')
  }
  if (b.consoleEntries?.length) {
    lines.push('## Console (derniers messages)')
    lines.push('```')
    for (const c of b.consoleEntries) {
      lines.push(`${formatTime(c.ts)}  [${c.level.toUpperCase()}]  ${c.text}`)
    }
    lines.push('```')
  }
  return lines.join('\n')
}

function openExternalLinkIssue(b: StoredBug) {
  const title = encodeURIComponent(`[Bug] ${b.description.slice(0, 80)}`)
  // GitHub limite la longueur de l'URL ; on tronque l'historique pour rester < ~8 KB
  const md = buildMarkdown(b)
  const truncated = md.length > 6000 ? md.slice(0, 6000) + '\n\n*(tronqué — voir l\'app pour la suite)*' : md
  const body  = encodeURIComponent(truncated)
  window.open(`https://github.com/${GITHUB_REPO}/issues/new?title=${title}&body=${body}`, '_blank')
}

export default function Bugs() {
  const { user, profile, isTemp } = useAuth()
  const [bugs, setBugs] = useState<StoredBug[]>([])
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState<'all' | 'auto' | 'manual'>('all')
  const [copied, setCopied] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [exportNotice, setExportNotice] = useState<string | null>(null)
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false)
  // Compose de réponse (réservé aux super-admins)
  const [replyTarget, setReplyTarget] = useState<StoredBug | null>(null)
  const [replyTitle, setReplyTitle] = useState('')
  const [replyBody,  setReplyBody]  = useState('')
  const [replySending, setReplySending] = useState(false)
  const [replyError, setReplyError] = useState<string | null>(null)

  const canReply = isSuperAdmin(profile?.displayName)

  function openReply(b: StoredBug) {
    setReplyTarget(b)
    // Pré-remplir un titre par défaut pour gagner du temps
    const preview = b.description.length > 60 ? b.description.slice(0, 60) + '…' : b.description
    setReplyTitle(`Réponse à : ${preview}`)
    setReplyBody('')
    setReplyError(null)
  }

  function closeReply() {
    setReplyTarget(null)
    setReplyTitle('')
    setReplyBody('')
    setReplyError(null)
    setReplySending(false)
  }

  async function sendReply() {
    if (!replyTarget || !user || !profile) return
    if (!replyTarget.reportedBy) {
      setReplyError("Ce bug n'a pas d'auteur identifié, impossible de répondre.")
      return
    }
    if (!replyBody.trim()) {
      setReplyError('Écris une réponse avant d\'envoyer.')
      return
    }
    setReplySending(true)
    setReplyError(null)
    try {
      await addDoc(collection(db, 'user_messages'), {
        toUid:        replyTarget.reportedBy,
        toUidName:    replyTarget.reportedByName ?? null,
        fromUid:      user.uid,
        fromUidName:  profile.displayName ?? null,
        title:        replyTitle.trim() || 'Réponse à ton signalement',
        body:         replyBody.trim(),
        relatedBugId: replyTarget.id,
        createdAt:    Date.now(),
        readAt:       null,
      })
      closeReply()
    } catch (e) {
      setReplyError('Échec de l\'envoi. Réessaie dans un instant.')
      console.warn('[bugs] sendReply:', e)
    } finally {
      setReplySending(false)
    }
  }

  useEffect(() => {
    const q = query(collection(db, 'bugReports'), orderBy('createdAt', 'desc'))
    const unsub = onSnapshot(q, snap => {
      setBugs(snap.docs.map(d => ({ id: d.id, ...d.data() } as StoredBug)))
    })
    return unsub
  }, [])

  const filtered = useMemo(() => {
    if (filter === 'all') return bugs
    return bugs.filter(b => b.source === filter)
  }, [bugs, filter])

  function toggle(id: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function copyMd(b: StoredBug) {
    try {
      await navigator.clipboard.writeText(buildMarkdown(b))
      setCopied(b.id)
      setTimeout(() => setCopied(null), 2000)
    } catch {
      setCopied('error')
      setTimeout(() => setCopied(null), 2000)
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteDoc(doc(db, 'bugReports', id))
    } catch {
      // ignoré : l'utilisateur verra le doc reste dans la liste, peut retry
    } finally {
      setConfirmDeleteId(null)
    }
  }

  const counts = useMemo(() => ({
    all:    bugs.length,
    auto:   bugs.filter(b => b.source === 'auto').length,
    manual: bugs.filter(b => b.source === 'manual').length,
  }), [bugs])

  /* Export bulk : tous les rapports filtrés en un seul markdown + JSON.
     JSON → toujours un téléchargement de fichier (le presse-papier perd la structure
     et n'a aucun intérêt). MD → téléchargement aussi par défaut ; on garde le
     bouton "Tout copier (MD)" séparé pour le presse-papier. */
  async function exportAll(format: 'md' | 'json') {
    if (filtered.length === 0) {
      setExportNotice('Rien à exporter.')
      setTimeout(() => setExportNotice(null), 2000)
      return
    }
    let content: string
    let filename: string
    let mime: string
    if (format === 'md') {
      content  = filtered.map((b, i) => `${i === 0 ? '' : '\n---\n\n'}${buildMarkdown(b)}`).join('')
      filename = `ferme-bugs-${new Date().toISOString().slice(0, 10)}.md`
      mime     = 'text/markdown'
    } else {
      content  = JSON.stringify(filtered.map(b => ({
        ...b,
        // Sérialise le createdAt Firestore en timestamp millis simple
        createdAt: tsOf(b),
      })), null, 2)
      filename = `ferme-bugs-${new Date().toISOString().slice(0, 10)}.json`
      mime     = 'application/json'
    }
    try {
      const blob = new Blob([content], { type: mime })
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href     = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      // revoke après un délai : sur certains navigateurs Android le téléchargement
      // est encore en cours quand l'event handler retourne
      setTimeout(() => URL.revokeObjectURL(url), 1500)
      setExportNotice(`✓ Téléchargement : ${filename}`)
    } catch {
      // Fallback presse-papier si le download ne passe pas (rare ; ex. webview très restreinte)
      try {
        await navigator.clipboard.writeText(content)
        setExportNotice(`✓ Copié dans le presse-papier (${filtered.length} rapport(s))`)
      } catch {
        setExportNotice('Échec export.')
      }
    }
    setTimeout(() => setExportNotice(null), 3500)
  }

  /* Copie MD pure (le bouton "Tout copier (MD)" reste utile pour coller dans un chat) */
  async function copyAllMd() {
    if (filtered.length === 0) {
      setExportNotice('Rien à copier.')
      setTimeout(() => setExportNotice(null), 2000)
      return
    }
    const content = filtered.map((b, i) => `${i === 0 ? '' : '\n---\n\n'}${buildMarkdown(b)}`).join('')
    try {
      await navigator.clipboard.writeText(content)
      setExportNotice(`✓ ${filtered.length} rapport(s) copiés dans le presse-papier`)
    } catch {
      setExportNotice('Presse-papier indisponible, utilise Export JSON.')
    }
    setTimeout(() => setExportNotice(null), 3500)
  }

  /* Suppression en masse, réservée aux utilisateurs réguliers (rules Firestore). */
  async function deleteAllFiltered() {
    setConfirmDeleteAll(false)
    let failed = 0
    for (const b of filtered) {
      try { await deleteDoc(doc(db, 'bugReports', b.id)) }
      catch { failed += 1 }
    }
    if (failed > 0) {
      setExportNotice(`Supprimé : ${filtered.length - failed}, échec : ${failed}`)
      setTimeout(() => setExportNotice(null), 3000)
    }
  }

  return (
    <div className="pb-24">
      <div className="px-5 pt-12 pb-6 bg-card border-b border-border">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-danger/15 flex items-center justify-center">
            <Bug size={22} className="text-danger" />
          </div>
          <div>
            <h1 className="text-charcoal text-xl font-bold m-0">Bugs rapportés</h1>
            <p className="text-xs text-muted mt-0.5">{counts.all} rapport(s) — auto : {counts.auto} · manuel : {counts.manual}</p>
          </div>
        </div>
      </div>

      {/* Filtres */}
      <div className="px-4 mt-4 flex gap-2">
        {(['all', 'auto', 'manual'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all
              ${filter === f
                ? 'bg-forest text-white'
                : 'bg-card border border-border text-muted active:bg-cream'}`}
          >
            {f === 'all' ? `Tous (${counts.all})` : f === 'auto' ? `⚠ Auto (${counts.auto})` : `👤 Manuels (${counts.manual})`}
          </button>
        ))}
      </div>

      {/* Actions globales : exporter / supprimer tout */}
      <div className="px-4 mt-3 flex gap-2">
        <button
          onClick={copyAllMd}
          disabled={filtered.length === 0}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl
                     border border-border text-xs font-semibold text-charcoal active:bg-cream
                     disabled:opacity-40"
          aria-label="Copier tous les rapports en Markdown"
        >
          <Copy size={13} /> Tout copier (MD)
        </button>
        <button
          onClick={() => exportAll('json')}
          disabled={filtered.length === 0}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl
                     border border-border text-xs font-semibold text-charcoal active:bg-cream
                     disabled:opacity-40"
          aria-label="Télécharger tous les rapports en JSON"
        >
          <Download size={13} /> Export JSON
        </button>
        {!isTemp && (
          confirmDeleteAll ? (
            <>
              <button
                onClick={deleteAllFiltered}
                className="flex-1 py-2 rounded-xl bg-danger text-white text-xs font-bold active:scale-95"
              >
                Tout supprimer ({filtered.length})
              </button>
              <button
                onClick={() => setConfirmDeleteAll(false)}
                className="px-3 py-2 rounded-xl border border-border text-xs text-muted active:bg-cream"
              >
                ✕
              </button>
            </>
          ) : (
            <button
              onClick={() => setConfirmDeleteAll(true)}
              disabled={filtered.length === 0}
              className="px-3 py-2 rounded-xl border border-danger/30 text-danger active:bg-danger/10 disabled:opacity-40"
              aria-label="Tout supprimer"
            >
              <Trash size={14} />
            </button>
          )
        )}
      </div>

      {exportNotice && (
        <div className="mx-4 mt-3 bg-meadow/10 border border-meadow/30 rounded-xl px-3 py-2 text-xs text-meadow font-semibold">
          {exportNotice}
        </div>
      )}

      {/* Liste */}
      <div className="px-4 mt-4 space-y-3">
        {filtered.length === 0 && (
          <div className="bg-card rounded-2xl p-8 text-center">
            <Bug size={28} className="text-muted/40 mx-auto mb-2" />
            <p className="text-sm text-muted">
              {filter === 'all' ? "Aucun rapport pour l'instant. Tout va bien (ou personne n'a signalé)."
                : 'Aucun rapport dans cette catégorie.'}
            </p>
          </div>
        )}

        {filtered.map(b => {
          const isOpen = expanded.has(b.id)
          const ts = tsOf(b)
          return (
            <div key={b.id} className="bg-card rounded-2xl shadow-sm overflow-hidden">
              <button
                onClick={() => toggle(b.id)}
                className="w-full flex items-start gap-3 p-4 text-left active:bg-cream transition-colors"
              >
                <div className={`mt-0.5 w-2 h-2 rounded-full flex-shrink-0
                  ${b.source === 'auto' ? 'bg-sun' : 'bg-forest'}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-charcoal text-sm font-semibold line-clamp-2">{b.description}</p>
                  <p className="text-[11px] text-muted mt-1">
                    {b.reportedByName ?? '—'} · {formatTime(ts)}
                    {b.replayed && <span className="ml-2 text-[10px] bg-sky/15 text-sky px-1.5 py-0.5 rounded">replay</span>}
                  </p>
                  {b.errorMessage && (
                    <p className="text-xs text-danger font-mono mt-1 line-clamp-1">{b.errorMessage}</p>
                  )}
                </div>
                {isOpen ? <ChevronDown size={18} className="text-muted flex-shrink-0 mt-1" />
                  : <ChevronRight size={18} className="text-muted flex-shrink-0 mt-1" />}
              </button>

              {isOpen && (
                <div className="px-4 pb-4 border-t border-border/40 space-y-3">
                  {b.errorStack && (
                    <details>
                      <summary className="text-xs font-semibold text-muted cursor-pointer py-2">Stack trace</summary>
                      <pre className="text-[10px] bg-cream/60 rounded-lg p-2 overflow-x-auto whitespace-pre-wrap break-all text-charcoal/80">
                        {b.errorStack}
                      </pre>
                    </details>
                  )}

                  {b.userActions && b.userActions.length > 0 && (
                    <details>
                      <summary className="text-xs font-semibold text-muted cursor-pointer py-2">
                        Actions ({b.userActions.length})
                      </summary>
                      <div className="bg-cream/60 rounded-lg p-2 max-h-48 overflow-y-auto text-[10px] font-mono space-y-0.5">
                        {b.userActions.map((a, i) => (
                          <div key={i} className="flex gap-2">
                            <span className="text-muted/70 flex-shrink-0">{new Date(a.ts).toLocaleTimeString('fr-FR')}</span>
                            <span className="text-forest font-bold flex-shrink-0">[{a.kind}]</span>
                            <span className="text-charcoal break-all">{a.label}</span>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}

                  {b.consoleEntries && b.consoleEntries.length > 0 && (
                    <details open>
                      <summary className="text-xs font-semibold text-muted cursor-pointer py-2">
                        Console ({b.consoleEntries.length})
                      </summary>
                      <div className="bg-cream/60 rounded-lg p-2 max-h-64 overflow-y-auto text-[10px] font-mono space-y-0.5">
                        {b.consoleEntries.map((c, i) => (
                          <div key={i} className="flex gap-2">
                            <span className="text-muted/70 flex-shrink-0">{new Date(c.ts).toLocaleTimeString('fr-FR')}</span>
                            <span className={`font-bold flex-shrink-0 ${levelColor(c.level)}`}>[{c.level}]</span>
                            <span className="text-charcoal break-all">{c.text}</span>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}

                  <div className="text-[11px] text-muted/80 space-y-0.5 pt-1 border-t border-border/40">
                    {b.url && <div><span className="font-semibold">URL : </span>{b.url}</div>}
                    {b.viewport && <div><span className="font-semibold">Viewport : </span>{b.viewport.w}×{b.viewport.h}</div>}
                    {b.userAgent && <div className="break-all"><span className="font-semibold">UA : </span>{b.userAgent}</div>}
                  </div>

                  <div className="flex gap-2 pt-2 flex-wrap">
                    {canReply && b.reportedBy && b.reportedBy !== user?.uid && (
                      <button
                        onClick={() => openReply(b)}
                        className="flex-1 min-w-[110px] flex items-center justify-center gap-1.5 py-2 rounded-xl
                                   bg-forest text-white text-xs font-semibold active:scale-95"
                      >
                        <Mail size={13} /> Répondre
                      </button>
                    )}
                    <button
                      onClick={() => copyMd(b)}
                      className="flex-1 min-w-[100px] flex items-center justify-center gap-1.5 py-2 rounded-xl
                                 border border-border text-xs font-semibold text-charcoal active:bg-cream"
                    >
                      <Copy size={13} /> {copied === b.id ? 'Copié ✓' : copied === 'error' ? 'Échec' : 'Copier MD'}
                    </button>
                    <button
                      onClick={() => openExternalLinkIssue(b)}
                      className="flex-1 min-w-[100px] flex items-center justify-center gap-1.5 py-2 rounded-xl
                                 bg-charcoal text-white text-xs font-semibold active:scale-95"
                    >
                      <ExternalLink size={13} /> Ouvrir issue
                    </button>
                    {!isTemp && (
                      confirmDeleteId === b.id ? (
                        <>
                          <button
                            onClick={() => handleDelete(b.id)}
                            className="flex-1 py-2 rounded-xl bg-danger text-white text-xs font-bold active:scale-95"
                          >
                            Confirmer
                          </button>
                          <button
                            onClick={() => setConfirmDeleteId(null)}
                            className="px-3 py-2 rounded-xl border border-border text-xs text-muted active:bg-cream"
                          >
                            ✕
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => setConfirmDeleteId(b.id)}
                          className="px-3 py-2 rounded-xl border border-border text-muted active:bg-cream"
                          aria-label="Supprimer"
                        >
                          <Trash2 size={14} />
                        </button>
                      )
                    )}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Note bas de page */}
      <div className="px-4 mt-6 text-center">
        <p className="text-[11px] text-muted/60 leading-relaxed">
          Bouton 🐞 flottant en bas à droite pour signaler un bug.<br />
          Les erreurs JavaScript non rattrapées sont capturées automatiquement.<br />
          La liste se rafraîchit toute seule (temps réel).
        </p>
        {!user && <p className="text-xs text-muted mt-2">Connecte-toi pour rapporter un bug.</p>}
      </div>

      {/* Modal de réponse au bug — réservé aux super-admins */}
      {replyTarget && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-3"
          onClick={closeReply}
        >
          <div
            className="bg-card w-full max-w-md rounded-3xl shadow-xl overflow-hidden flex flex-col max-h-[90vh]"
            onClick={e => e.stopPropagation()}
          >
            <div className="px-5 pt-5 pb-3 flex items-start justify-between border-b border-border/40">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-muted uppercase tracking-wider">
                  Répondre à {replyTarget.reportedByName ?? 'cet utilisateur'}
                </p>
                <p className="text-xs text-muted/80 mt-1 line-clamp-2">
                  « {replyTarget.description} »
                </p>
              </div>
              <button
                onClick={closeReply}
                className="ml-2 w-8 h-8 rounded-lg bg-cream flex items-center justify-center active:scale-95 flex-shrink-0"
                aria-label="Fermer"
              >
                <X size={16} className="text-muted" />
              </button>
            </div>

            <div className="px-5 py-4 space-y-3 overflow-y-auto">
              <label className="block">
                <span className="text-xs font-semibold text-charcoal block mb-1.5">Titre du message</span>
                <input
                  type="text"
                  value={replyTitle}
                  onChange={e => setReplyTitle(e.target.value)}
                  maxLength={100}
                  className="w-full px-3 py-2 rounded-xl border border-border bg-cream text-sm text-charcoal
                             focus:outline-none focus:ring-2 focus:ring-forest/30"
                  placeholder="Réponse à ta question"
                />
              </label>

              <label className="block">
                <span className="text-xs font-semibold text-charcoal block mb-1.5">Message</span>
                <textarea
                  value={replyBody}
                  onChange={e => setReplyBody(e.target.value)}
                  rows={8}
                  className="w-full px-3 py-2 rounded-xl border border-border bg-cream text-sm text-charcoal
                             focus:outline-none focus:ring-2 focus:ring-forest/30 resize-y"
                  placeholder="Explique-lui comment faire, ou réponds à sa question. Le message reste consultable dans sa boîte de réception."
                />
              </label>

              <p className="text-[11px] text-muted italic">
                Le destinataire verra ce message sur son Dashboard et pourra le relire dans
                <strong> Messages</strong>. Aucune notification push n'est envoyée.
              </p>

              {replyError && (
                <p className="text-xs text-danger bg-danger/10 border border-danger/30 rounded-lg px-3 py-2">
                  {replyError}
                </p>
              )}
            </div>

            <div className="px-5 py-3 border-t border-border/40 flex gap-2 flex-shrink-0">
              <button
                onClick={closeReply}
                disabled={replySending}
                className="px-4 py-2.5 rounded-xl border border-border text-sm font-semibold text-muted active:bg-cream disabled:opacity-50"
              >
                Annuler
              </button>
              <button
                onClick={sendReply}
                disabled={replySending || !replyBody.trim()}
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl
                           bg-forest text-white text-sm font-bold active:scale-95
                           disabled:opacity-50 disabled:active:scale-100"
              >
                <Mail size={15} /> {replySending ? 'Envoi…' : 'Envoyer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
