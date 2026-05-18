import { X, AlertTriangle, Bell } from 'lucide-react'
import type { ToastMsg } from '../hooks/useMessaging'

const TOAST_STYLE: Record<string, { bg: string; icon: string; bar: string }> = {
  urgent:  { bg: 'bg-danger/95',  icon: 'text-white', bar: 'bg-white/30' },
  warning: { bg: 'bg-sun/95',     icon: 'text-white', bar: 'bg-white/30' },
  info:    { bg: 'bg-forest/95',  icon: 'text-white', bar: 'bg-meadow/60' },
}

function ToastIcon({ severity }: { severity?: string }) {
  if (severity === 'urgent' || severity === 'warning')
    return <AlertTriangle size={18} className="flex-shrink-0" />
  return <Bell size={18} className="flex-shrink-0" />
}

interface Props {
  toasts: ToastMsg[]
  dismiss: (id: number) => void
}

export default function Toaster({ toasts, dismiss }: Props) {
  if (!toasts.length) return null

  return (
    <div className="fixed top-0 left-0 right-0 z-[9999] flex flex-col gap-2 p-3 pointer-events-none">
      {toasts.map(toast => {
        const style = TOAST_STYLE[toast.severity ?? 'info'] ?? TOAST_STYLE.info
        return (
          <div
            key={toast.id}
            className={`toast-enter flex items-start gap-3 rounded-2xl px-4 py-3 shadow-2xl
                        pointer-events-auto ${style.bg} backdrop-blur-sm`}
          >
            <span className={style.icon}>
              <ToastIcon severity={toast.severity} />
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-white font-semibold text-sm leading-tight">{toast.title}</p>
              {toast.body && (
                <p className="text-white/80 text-xs mt-0.5 leading-snug">{toast.body}</p>
              )}
            </div>
            <button
              onClick={() => dismiss(toast.id)}
              className="flex-shrink-0 text-white/60 active:text-white p-0.5"
            >
              <X size={16} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
