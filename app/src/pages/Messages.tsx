import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  collection, onSnapshot, query, where, doc, updateDoc, deleteDoc,
} from '../services/firestoreMonitor'
import { ArrowLeft, Megaphone, Mail, MailOpen, Trash2, ChevronDown, ChevronUp } from 'lucide-react'
import { db } from '../firebase'
import { useAuth } from '../hooks/useAuth'
import type { UserMessage } from '../types'
import {
  getVisibleAnnouncements,
  getReadAnnouncementIds,
  markAnnouncementRead,
  type Announcement,
} from '../data/announcements'

function formatTime(ts: number): string {
  const d = new Date(ts)
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const ystrd = new Date(today); ystrd.setDate(ystrd.getDate() - 1)
  if (d.getTime() >= today.getTime()) {
    return `Aujourd'hui ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`
  }
  if (d.getTime() >= ystrd.getTime()) {
    return `Hier ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`
  }
  return d.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })
}

// Représentation unifiée annonce statique + message Firestore. La page traite les deux
// avec la même UI ; seule la source change (impacte uniquement la persistance du "lu").
interface Item {
  source:    'static' | 'firestore'
  id:        string
  title:     string
  body:      string
  fromName:  string
  createdAt: number
  read:      boolean
  // Firestore-only — pour la suppression et l'update readAt
  firestoreId?: string
}

/**
 * Page "Annonces" — fil unifié des messages adressés à l'utilisatrice courante.
 *
 * Deux sources fusionnées :
 *   - Annonces statiques (`data/announcements.ts`) — éditées directement dans le code,
 *     ciblées par displayName ou broadcast. Marquage "lu" en localStorage.
 *   - Messages Firestore (`user_messages`) — système legacy pour répondre à un bug
 *     depuis /bugs. Reste dispo mais peu utilisé.
 *
 * Tri par date desc, marquage lu au déploiement du panneau.
 */
export default function Messages() {
  const navigate = useNavigate()
  const { user, profile } = useAuth()
  const [firestoreMessages, setFirestoreMessages] = useState<UserMessage[]>([])
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  // Trigger pour relire localStorage quand on marque lu (state local seulement)
  const [readTick, setReadTick] = useState(0)

  useEffect(() => {
    if (!user) return
    const q = query(collection(db, 'user_messages'), where('toUid', '==', user.uid))
    const unsub = onSnapshot(q, snap => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() } as UserMessage))
      list.sort((a, b) => b.createdAt - a.createdAt)
      setFirestoreMessages(list)
    }, err => console.warn('[announcements] read:', err.code))
    return unsub
  }, [user])

  // Fusion annonces statiques + messages Firestore. `readTick` invalide le memo
  // après un markAnnouncementRead pour rafraîchir les badges sans Firestore.
  const items = useMemo<Item[]>(() => {
    const staticAnns: Announcement[] = getVisibleAnnouncements(profile?.displayName)
    const readIds = getReadAnnouncementIds()

    const staticItems: Item[] = staticAnns.map(a => ({
      source:    'static',
      id:        `static:${a.id}`,
      title:     a.title,
      body:      a.body,
      fromName:  'Équipe Ferme',
      createdAt: a.createdAt,
      read:      readIds.has(a.id),
    }))

    const fsItems: Item[] = firestoreMessages.map(m => ({
      source:      'firestore',
      id:          `fs:${m.id}`,
      title:       m.title,
      body:        m.body,
      fromName:    m.fromUidName ?? 'Quelqu\'un',
      createdAt:   m.createdAt,
      read:        !!m.readAt,
      firestoreId: m.id,
    }))

    return [...staticItems, ...fsItems].sort((a, b) => b.createdAt - a.createdAt)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firestoreMessages, profile?.displayName, readTick])

  const unreadCount = useMemo(() => items.filter(i => !i.read).length, [items])

  async function markFirestoreRead(firestoreId: string) {
    if (!user) return
    try {
      await updateDoc(doc(db, 'user_messages', firestoreId), { readAt: Date.now() })
    } catch (e) {
      console.warn('[announcements] markRead:', e)
    }
  }

  function toggle(it: Item) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(it.id)) {
        next.delete(it.id)
      } else {
        next.add(it.id)
        // Marquer lu à la première ouverture
        if (!it.read) {
          if (it.source === 'static') {
            // L'id stocké en localStorage est l'id "court" sans préfixe
            markAnnouncementRead(it.id.replace(/^static:/, ''))
            setReadTick(t => t + 1)
          } else if (it.firestoreId) {
            void markFirestoreRead(it.firestoreId)
          }
        }
      }
      return next
    })
  }

  async function handleDelete(it: Item) {
    // Annonce statique : on la marque juste comme lue (pas supprimable, vient du code)
    if (it.source === 'static') {
      markAnnouncementRead(it.id.replace(/^static:/, ''))
      setReadTick(t => t + 1)
      setConfirmDeleteId(null)
      return
    }
    if (!it.firestoreId) return
    try {
      await deleteDoc(doc(db, 'user_messages', it.firestoreId))
    } catch (e) {
      console.warn('[announcements] delete:', e)
    } finally {
      setConfirmDeleteId(null)
    }
  }

  return (
    <div className="pb-24">
      {/* Header */}
      <div className="px-5 pt-12 pb-6 bg-card border-b border-border">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="w-9 h-9 rounded-xl bg-cream flex items-center justify-center active:scale-95"
            aria-label="Retour"
          >
            <ArrowLeft size={18} className="text-charcoal" />
          </button>
          <div className="flex-1">
            <h1 className="text-charcoal text-xl font-bold m-0 flex items-center gap-2">
              <Megaphone size={20} className="text-forest" />
              Annonces
            </h1>
            <p className="text-xs text-muted mt-0.5">
              {items.length === 0
                ? 'Aucune annonce pour le moment.'
                : `${items.length} annonce${items.length > 1 ? 's' : ''}` +
                  (unreadCount > 0 ? ` · ${unreadCount} non lue${unreadCount > 1 ? 's' : ''}` : '')}
            </p>
          </div>
        </div>
      </div>

      {/* Liste */}
      <div className="px-4 mt-4 space-y-2">
        {items.length === 0 && (
          <div className="bg-card rounded-2xl p-8 text-center">
            <Megaphone size={28} className="text-muted/40 mx-auto mb-2" />
            <p className="text-sm text-muted">
              Aucune annonce pour le moment.<br />
              Tu verras ici les réponses à tes signalements et les annonces de l'équipe.
            </p>
          </div>
        )}

        {items.map(it => {
          const isOpen = expanded.has(it.id)
          return (
            <div
              key={it.id}
              className={`rounded-2xl shadow-sm overflow-hidden border ${
                !it.read ? 'bg-forest/5 border-forest/30' : 'bg-card border-border/40'
              }`}
            >
              <button
                onClick={() => toggle(it)}
                className="w-full flex items-start gap-3 p-4 text-left active:bg-cream/50 transition-colors"
              >
                <div className={`mt-0.5 flex-shrink-0 ${!it.read ? 'text-forest' : 'text-muted'}`}>
                  {!it.read ? <Mail size={18} /> : <MailOpen size={18} />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm line-clamp-2 ${!it.read ? 'font-bold text-charcoal' : 'font-semibold text-charcoal/80'}`}>
                    {it.title}
                  </p>
                  <p className="text-[11px] text-muted mt-1">
                    {it.fromName} · {formatTime(it.createdAt)}
                    {!it.read && <span className="ml-2 text-[10px] bg-forest text-white px-1.5 py-0.5 rounded font-bold">NOUVEAU</span>}
                  </p>
                </div>
                {isOpen
                  ? <ChevronUp size={18} className="text-muted flex-shrink-0 mt-1" />
                  : <ChevronDown size={18} className="text-muted flex-shrink-0 mt-1" />}
              </button>

              {isOpen && (
                <div className="px-4 pb-4 pt-1 border-t border-border/40 space-y-3">
                  <p className="text-sm text-charcoal whitespace-pre-wrap leading-relaxed">
                    {it.body}
                  </p>

                  <div className="flex gap-2 pt-1">
                    {confirmDeleteId === it.id ? (
                      <>
                        <button
                          onClick={() => handleDelete(it)}
                          className="flex-1 py-2 rounded-xl bg-danger text-white text-xs font-bold active:scale-95"
                        >
                          {it.source === 'static' ? 'Masquer' : 'Supprimer définitivement'}
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
                        onClick={() => setConfirmDeleteId(it.id)}
                        className="ml-auto px-3 py-2 rounded-xl border border-border text-muted text-xs active:bg-cream flex items-center gap-1.5"
                        aria-label={it.source === 'static' ? 'Masquer' : 'Supprimer'}
                      >
                        <Trash2 size={13} /> {it.source === 'static' ? 'Masquer' : 'Supprimer'}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="px-4 mt-6 text-center">
        <p className="text-[11px] text-muted/60 leading-relaxed">
          Les annonces restent ici tant que tu ne les masques pas.<br />
          Tu peux les relire autant de fois que tu veux.
        </p>
      </div>
    </div>
  )
}
