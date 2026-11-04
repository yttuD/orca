import React, { useEffect, useState } from 'react'
import { Cable, CheckCircle2, CircleAlert, CircleOff } from 'lucide-react'

type FeedHealth = Awaited<ReturnType<typeof window.api.managed.edgeHealth>>

/** Read-only feed diagnostic. Does not indicate that the browser delivered a receipt. */
export function ManagedEdgeBridgeHealth(): React.JSX.Element {
  const [health, setHealth] = useState<FeedHealth | null>(null)

  useEffect(() => {
    let mounted = true
    const check = async () => {
      try {
        const value = await window.api.managed.edgeHealth()
        if (mounted) setHealth(value)
      } catch {
        if (mounted) setHealth({ status: 'OFFLINE', port: 8768 })
      }
    }
    void check()
    const interval = setInterval(() => void check(), 15000)
    return () => { mounted = false; clearInterval(interval) }
  }, [])

  const active = health?.status === 'ONLINE'
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
        <span>{health?.port ?? 8768}</span>
        {active && health?.latest_seq !== undefined
          ? <span>· seq {health.latest_seq}</span>
          : null}
      </div>
      <span className="sr-only">
        El estado del feed no confirma la entrega de mensajes a ChatGPT.
      </span>
    </div>
  )
}
