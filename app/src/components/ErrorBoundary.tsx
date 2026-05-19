import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

// Détecte les erreurs typiques d'un chunk lazy-loaded échoué :
// - après un redéploiement, les anciens hash de chunks ne sont plus servis
// - sur 4G/5G faible, un fetch de chunk peut planter
// Dans ces cas-là, recharger la page résout le souci.
function isChunkLoadError(err: Error): boolean {
  const msg = `${err.name} ${err.message}`.toLowerCase()
  return (
    msg.includes('chunkloaderror') ||
    msg.includes('loading chunk') ||
    msg.includes('failed to fetch dynamically imported module') ||
    msg.includes('importing a module script failed')
  )
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info)
    // Auto-rechargement une seule fois en cas d'erreur de chunk
    // (typiquement après un redéploiement). Sentinelle en sessionStorage
    // pour éviter une boucle de rechargement infinie si l'erreur persiste.
    if (isChunkLoadError(error)) {
      try {
        const RELOADED_KEY = 'fm_chunk_reloaded_at'
        const last = Number(sessionStorage.getItem(RELOADED_KEY) ?? 0)
        if (Date.now() - last > 60_000) {
          sessionStorage.setItem(RELOADED_KEY, String(Date.now()))
          window.location.reload()
        }
      } catch { /* sessionStorage indisponible */ }
    }
  }

  handleReload = () => {
    window.location.reload()
  }

  render() {
    if (this.state.error) {
      const chunk = isChunkLoadError(this.state.error)
      return (
        <div className="flex h-full min-h-screen items-center justify-center bg-cream px-6">
          <div className="max-w-sm text-center">
            <div className="text-5xl mb-4">🌿</div>
            <h1 className="text-xl font-bold text-charcoal mb-2">
              {chunk ? 'Mise à jour disponible' : 'Une erreur est survenue'}
            </h1>
            <p className="text-sm text-muted mb-6">
              {chunk
                ? 'Une nouvelle version est en ligne — recharge la page pour la récupérer.'
                : "L'application a rencontré un problème. Recharge la page pour repartir."}
            </p>
            <button
              onClick={this.handleReload}
              className="bg-forest text-white font-semibold py-3 px-6 rounded-2xl active:scale-95 transition-all"
            >
              Recharger
            </button>
            {!chunk && (
              <details className="mt-6 text-left text-xs text-muted/70">
                <summary className="cursor-pointer">Détails techniques</summary>
                <pre className="mt-2 whitespace-pre-wrap break-all">{String(this.state.error.message || this.state.error)}</pre>
              </details>
            )}
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
