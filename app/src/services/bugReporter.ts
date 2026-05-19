import { addDoc, collection, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'
import { withTimeout, FirestoreWriteTimeoutError } from './firestoreWrite'

/**
 * Service global de capture de bugs.
 *
 * - Patche console.log/info/warn/error/debug dès le chargement du module
 *   pour buffer les 500 dernières lignes (ring buffer).
 * - Écoute window.error + unhandledrejection pour capturer toutes les erreurs
 *   non rattrapées et les pousser dans la queue d'auto-report.
 * - Trace les actions utilisateur (clics, navigations) dans un buffer parallèle.
 * - Expose `report()` pour envoyer un bundle complet (manuel ou auto) à
 *   Firestore (collection `bugReports`). Fallback localStorage si l'écriture
 *   Firestore échoue, replay automatique à la prochaine occasion.
 */

const CONSOLE_BUFFER_SIZE = 500
const ACTION_BUFFER_SIZE  = 100
const LOCAL_QUEUE_KEY     = 'fm_bug_queue'
const LOCAL_QUEUE_MAX     = 20

export type ConsoleLevel = 'log' | 'info' | 'warn' | 'error' | 'debug'

export interface ConsoleEntry {
  level: ConsoleLevel
  ts:    number
  text:  string
}

export interface ActionEntry {
  ts:    number
  kind:  'nav' | 'click' | 'auth' | 'firestore' | 'note'
  label: string
}

export interface BugSnapshot {
  consoleEntries: ConsoleEntry[]
  userActions:    ActionEntry[]
  url:            string
  userAgent:      string
  viewport:       { w: number; h: number }
  capturedAt:     number
}

export interface BugReport extends BugSnapshot {
  source:         'manual' | 'auto'
  description:    string
  errorMessage?:  string
  errorStack?:    string
  reportedBy?:    string  // uid
  reportedByName?: string
}

/* ─── State ─── */

const consoleBuffer: ConsoleEntry[] = []
const actionBuffer:  ActionEntry[]  = []

let reporterUserUid:  string | null = null
let reporterUserName: string | null = null
let installed = false
// Réentrance : on désactive le patch console quand on logge nous-mêmes.
let internalLog = false

// Listeners pour notifier l'UI quand un auto-report est ajouté.
type AutoReportListener = (description: string) => void
const autoReportListeners: AutoReportListener[] = []

export function onAutoReport(fn: AutoReportListener): () => void {
  autoReportListeners.push(fn)
  return () => {
    const i = autoReportListeners.indexOf(fn)
    if (i >= 0) autoReportListeners.splice(i, 1)
  }
}

/* ─── Buffers ─── */

function pushConsole(entry: ConsoleEntry) {
  consoleBuffer.push(entry)
  if (consoleBuffer.length > CONSOLE_BUFFER_SIZE) {
    consoleBuffer.splice(0, consoleBuffer.length - CONSOLE_BUFFER_SIZE)
  }
}

export function pushAction(kind: ActionEntry['kind'], label: string) {
  actionBuffer.push({ ts: Date.now(), kind, label: label.slice(0, 200) })
  if (actionBuffer.length > ACTION_BUFFER_SIZE) {
    actionBuffer.splice(0, actionBuffer.length - ACTION_BUFFER_SIZE)
  }
}

function safeStringify(arg: unknown): string {
  if (arg === null) return 'null'
  if (arg === undefined) return 'undefined'
  if (typeof arg === 'string') return arg
  if (typeof arg === 'number' || typeof arg === 'boolean') return String(arg)
  if (arg instanceof Error) {
    return `${arg.name}: ${arg.message}${arg.stack ? '\n' + arg.stack : ''}`
  }
  try {
    return JSON.stringify(arg, (_k, v) => {
      // Trim long strings dans les payloads
      if (typeof v === 'string' && v.length > 500) return v.slice(0, 500) + '…'
      return v
    })
  } catch {
    try { return String(arg) } catch { return '[unstringifiable]' }
  }
}

function formatArgs(args: unknown[]): string {
  return args.map(safeStringify).join(' ').slice(0, 2000)
}

/* ─── Console patching ─── */

function installConsolePatch() {
  if (typeof window === 'undefined') return
  const levels: ConsoleLevel[] = ['log', 'info', 'warn', 'error', 'debug']
  for (const level of levels) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const orig = (console as any)[level]?.bind(console)
    if (!orig) continue
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(console as any)[level] = (...args: unknown[]) => {
      if (!internalLog) {
        try {
          pushConsole({ level, ts: Date.now(), text: formatArgs(args) })
        } catch { /* on ne casse jamais console */ }
      }
      orig(...args)
    }
  }
}

/* ─── Error listeners ─── */

function installErrorListeners() {
  if (typeof window === 'undefined') return

  window.addEventListener('error', (ev) => {
    const msg = ev.message || 'Erreur JS inconnue'
    const stack = (ev.error && ev.error.stack) || `${ev.filename}:${ev.lineno}:${ev.colno}`
    pushConsole({ level: 'error', ts: Date.now(), text: `[window.error] ${msg}` })
    queueAutoReport({
      description:  '⚠ Erreur automatique capturée',
      errorMessage: msg,
      errorStack:   String(stack).slice(0, 4000),
    })
  })

  window.addEventListener('unhandledrejection', (ev) => {
    const reason = ev.reason
    const msg = reason instanceof Error ? reason.message : safeStringify(reason)
    const stack = reason instanceof Error ? (reason.stack ?? '') : ''
    pushConsole({ level: 'error', ts: Date.now(), text: `[unhandledrejection] ${msg}` })
    queueAutoReport({
      description:  '⚠ Promise rejetée non rattrapée',
      errorMessage: msg,
      errorStack:   String(stack).slice(0, 4000),
    })
  })
}

/* ─── Auto-report dedupe + queue ─── */

// Évite de spammer Firestore si la même erreur survient 50 fois d'affilée.
let lastAutoReportKey = ''
let lastAutoReportTs  = 0
const AUTO_DEDUPE_MS  = 15_000

function queueAutoReport(partial: Pick<BugReport, 'description' | 'errorMessage' | 'errorStack'>) {
  const key = `${partial.description}::${partial.errorMessage ?? ''}`
  const now = Date.now()
  if (key === lastAutoReportKey && now - lastAutoReportTs < AUTO_DEDUPE_MS) return
  lastAutoReportKey = key
  lastAutoReportTs  = now

  // Notifie l'UI (toast discret)
  for (const fn of autoReportListeners) {
    try { fn(partial.description) } catch { /* ignoré */ }
  }

  // Envoie en arrière-plan
  void doSendReport({
    source:        'auto',
    description:   partial.description,
    errorMessage:  partial.errorMessage,
    errorStack:    partial.errorStack,
    ...buildSnapshot(),
  })
}

/* ─── Snapshot builder ─── */

function buildSnapshot(): BugSnapshot {
  return {
    consoleEntries: consoleBuffer.slice(-150), // 150 dernières pour limiter taille payload
    userActions:    actionBuffer.slice(-50),
    url:            typeof window !== 'undefined' ? window.location.href : '',
    userAgent:      typeof navigator !== 'undefined' ? navigator.userAgent : '',
    viewport:       typeof window !== 'undefined'
                      ? { w: window.innerWidth, h: window.innerHeight }
                      : { w: 0, h: 0 },
    capturedAt:     Date.now(),
  }
}

/* ─── Identité du reporter ─── */

export function setReporterIdentity(uid: string | null, displayName: string | null) {
  reporterUserUid  = uid
  reporterUserName = displayName
}

/* ─── Envoi vers Firestore (avec fallback localStorage) ─── */

interface QueuedReport extends BugReport {
  queuedAt: number
}

function readQueue(): QueuedReport[] {
  try {
    const raw = localStorage.getItem(LOCAL_QUEUE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch { return [] }
}

function writeQueue(items: QueuedReport[]) {
  try {
    const trimmed = items.slice(-LOCAL_QUEUE_MAX)
    localStorage.setItem(LOCAL_QUEUE_KEY, JSON.stringify(trimmed))
  } catch { /* localStorage saturé : on tronque + retry */
    try { localStorage.setItem(LOCAL_QUEUE_KEY, JSON.stringify(items.slice(-5))) } catch {}
  }
}

function enqueueLocal(report: BugReport) {
  const q = readQueue()
  q.push({ ...report, queuedAt: Date.now() })
  writeQueue(q)
}

async function flushLocalQueue() {
  const q = readQueue()
  if (q.length === 0) return
  const remaining: QueuedReport[] = []
  for (const item of q) {
    try {
      // Pas de retry agressif : on tente une fois par item
      await withTimeout(
        addDoc(collection(db, 'bugReports'), {
          ...item,
          createdAt: serverTimestamp(),
          replayed:  true,
        }),
        6_000,
      )
    } catch {
      remaining.push(item)
    }
  }
  writeQueue(remaining)
}

async function doSendReport(report: BugReport): Promise<void> {
  // Identité au moment de l'envoi (peut être null si pas connecté)
  const payload: BugReport = {
    ...report,
    reportedBy:     reporterUserUid ?? undefined,
    reportedByName: reporterUserName ?? undefined,
  }
  try {
    internalLog = true
    await withTimeout(
      addDoc(collection(db, 'bugReports'), {
        ...payload,
        createdAt: serverTimestamp(),
      }),
      8_000,
    )
    // Si OK, profitons-en pour drainer la queue locale
    flushLocalQueue().catch(() => {})
  } catch (e) {
    // Quota/timeout/réseau : stocker en local pour replay ultérieur
    enqueueLocal(payload)
    if (!(e instanceof FirestoreWriteTimeoutError)) {
      // On ne re-log pas via console pour éviter récursion : utilise pushConsole direct
      pushConsole({
        level: 'warn',
        ts:    Date.now(),
        text:  `[bugReporter] Échec envoi bug report, mis en file localStorage: ${safeStringify(e)}`,
      })
    }
  } finally {
    internalLog = false
  }
}

/* ─── API publique ─── */

export async function reportBug(description: string, opts?: { source?: 'manual' | 'auto' }): Promise<void> {
  const report: BugReport = {
    source:      opts?.source ?? 'manual',
    description: description.slice(0, 5000),
    ...buildSnapshot(),
  }
  await doSendReport(report)
}

export function getCurrentSnapshot(): BugSnapshot {
  return buildSnapshot()
}

export function getQueueLength(): number {
  return readQueue().length
}

/* ─── Initialisation ─── */

export function initBugReporter() {
  if (installed) return
  installed = true
  installConsolePatch()
  installErrorListeners()
  // Tente de drainer la queue au lancement (au cas où l'app a planté hier)
  // Pas critique si ça échoue.
  setTimeout(() => { flushLocalQueue().catch(() => {}) }, 5_000)
  pushAction('note', 'bugReporter installé')
}
