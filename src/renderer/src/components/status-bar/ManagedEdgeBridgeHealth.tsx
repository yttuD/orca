import React, { useEffect, useState } from 'react'
import { Cable, CheckCircle2, CircleAlert, CircleOff } from 'lucide-react'

type FeedHealth = Awaited<ReturnType<typeof window.api.managed.edgeHealth>>

/** Explicit local-only hints: do not expose raw HTTP payloads or credentials. */
export function feedHealthHint(code?: string): string | null {
  switch (code) {
    case 'LOCAL_FEED_TOKEN_MISSING': return 'Token local del feed no encontrado'
    case 'FEED_AUTH_REJECTED': return 'Autenticación del feed rechazada'
    case 'FEED_NOT_REACHABLE': return 'El feed local no responde'
    case 'FEED_RESPONSE_TOO_LARGE': return 'Respuesta del feed fuera de límite'
    case 'FEED_INVALID_JSON':
    case 'FEED_INVALID_RESPONSE': return 'Respuesta del feed inválida'
    case 'INVALID_QA_PORT': return 'Puerto QA no permitido'
    case 'INVALID_E2E_PORT': return 'Puerto de prueba inválido'
    case 'DESKTOP_OPERATOR_REQUIRED': return 'Ventana no autorizada'
    default: return null
  }
}

/** Read-only feed diagnostic. Does not indicate that the browser delivered a receipt. */
export function ManagedEdgeBridgeHealth(): React.JSX.Element {
  const [health, setHealth] = useState<FeedHealth | null>(null)

  useEffect(() => {
    let mounted = true
    let checking = false
    const check = async () => {
      // Avoid overlapping IPC probes and older responses overwriting newer health.
      if (checking) return
      checking = true
      try {
        const value = await window.api.managed.edgeHealth()
        if (mounted) setHealth(value)
      } catch {
        if (mounted) setHealth((previous) => ({
          status: 'OFFLINE',
          port: previous?.port ?? 8768,
          error_code: 'FEED_NOT_REACHABLE'
        }))
      } finally {
        checking = false
      }
    }
    void check()
    const interval = setInterval(() => void check(), 15000)
    return () => { mounted = false; clearInterval(interval) }
  }, [])

  const active = health?.status === 'ONLINE'
  const isQa = health !== null && health?.port !== undefined && health.port !== 8768
  const hint = feedHealthHint(health?.error_code)
  const label = active ? 'Feed WCB activo'
    : health?.status === 'LEGACY' ? 'Feed WCB versión anterior'
      : health?.status === 'NOT_CONFIGURED' ? 'Feed WCB sin configurar'
        : health?.status === 'ERROR' ? 'Feed WCB con error'
          : 'Feed WCB desconectado'

  return (
    <div className="flex items-center justify-between rounded border border-border/40 bg-muted/20 px-2.5 py-1.5 text-[10px]">
      <div className="flex items-center gap-1.5">
        {active
          ? <CheckCircle2 className="size-3.5 text-emerald-400" />
          : health?.status === 'ERROR'
            ? <CircleAlert className="size-3.5 text-amber-400" />
            : <CircleOff className="size-3.5 text-zinc-400" />}
        <span className="font-medium text-foreground">{label}</span>
      </div>
      <div className="flex items-center gap-1 text-muted-foreground font-mono">
        <Cable className="size-3" />
        {isQa ? <span className="font-sans">QA</span> : null}
        <span>{health?.port ?? 8768}</span>
        {active && health?.latest_seq !== undefined
          ? <span>· seq {health.latest_seq}</span>
          : null}
      </div>
      <span className="sr-only" aria-live="polite">
        {hint ? `${hint}. ` : ''}
        El estado del feed no confirma que el worker esté operativo ni la entrega de mensajes a ChatGPT.
      </span>
    </div>
  )
}
