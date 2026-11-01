import React, { useCallback, useEffect, useState } from 'react'
import { Layers, RefreshCw, ShieldAlert, ShieldCheck } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

type ManagedProject = {
  readonly id: string
  readonly name: string
  readonly description?: string | null
  readonly status: string
  readonly mode: string
  readonly created_at?: string | null
  readonly updated_at?: string | null
}

type ManagedStatus = 'ONLINE' | 'OFFLINE' | 'ERROR' | 'LOADING'

export function ManagedStatusSegment({
  iconOnly = false
}: {
  iconOnly?: boolean
}): React.JSX.Element {
  const [status, setStatus] = useState<ManagedStatus>('LOADING')
  const [projects, setProjects] = useState<readonly ManagedProject[]>([])
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const fetchStatus = useCallback(async () => {
    setRefreshing(true)
    try {
      if (!window.api?.managed?.listProjects) {
        setStatus('OFFLINE')
        setErrorMessage('Bridge managed no disponible en este entorno.')
        setProjects([])
        return
      }
      const res = await window.api.managed.listProjects()
      if (res.ok && res.status === 'ONLINE') {
        setStatus('ONLINE')
        setProjects(res.projects || [])
        setErrorMessage(null)
      } else if (res.status === 'OFFLINE') {
        setStatus('OFFLINE')
        setProjects([])
        setErrorMessage(res.error_message || 'Motor Python desconectado')
      } else {
        setStatus('ERROR')
        setProjects([])
        setErrorMessage(res.error_message || 'Error en respuesta RPC')
      }
    } catch (err: unknown) {
      setStatus('OFFLINE')
      setProjects([])
      setErrorMessage(err instanceof Error ? err.message : 'Fallo de conexión al motor')
    } finally {
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    fetchStatus()
    // Poll cautiously every 15s to keep status fresh without flooding host
    const interval = setInterval(fetchStatus, 15000)
    return () => clearInterval(interval)
  }, [fetchStatus])

  const statusBadge = {
    ONLINE: {
      color: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
      dot: 'bg-emerald-500',
      label: 'ONLINE'
    },
    OFFLINE: {
      color: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30',
      dot: 'bg-zinc-500',
      label: 'OFFLINE'
    },
    ERROR: {
      color: 'bg-rose-500/15 text-rose-400 border-rose-500/30',
      dot: 'bg-rose-500',
      label: 'ERROR'
    },
    LOADING: {
      color: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
      dot: 'bg-amber-500 animate-pulse',
      label: '...'
    }
  }[status]

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="inline-flex cursor-pointer items-center gap-1.5 rounded px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-accent/70 hover:text-foreground"
              aria-label="Proyectos Gestionados"
            >
              <Layers className="size-3.5 text-sky-400" />
              {!iconOnly ? (
                <span className="inline-flex items-center gap-1 font-mono text-[11px]">
                  <span className={`inline-block size-1.5 rounded-full ${statusBadge.dot}`} />
                  <span className="text-zinc-300">Managed</span>
                </span>
              ) : null}
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={4}>
          <span>Centro de Proyectos Gestionados (Motor Python: {statusBadge.label})</span>
        </TooltipContent>
      </Tooltip>

      <PopoverContent
        side="top"
        align="start"
        sideOffset={6}
        className="w-80 rounded-lg border border-border/60 bg-popover/95 p-3.5 shadow-xl backdrop-blur-md"
      >
        <div className="flex flex-col gap-3">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border/40 pb-2">
            <div className="flex items-center gap-2">
              <Layers className="size-4 text-sky-400" />
              <span className="font-semibold text-sm tracking-tight text-foreground">
                Proyectos Gestionados
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wider ${statusBadge.color}`}
              >
                <span className={`size-1.5 rounded-full ${statusBadge.dot}`} />
                {statusBadge.label}
              </span>
              <button
                type="button"
                onClick={fetchStatus}
                disabled={refreshing}
                className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
                title="Actualizar estado"
              >
                <RefreshCw className={`size-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>

          {/* Subtitle / Mode info */}
          <div className="rounded border border-sky-500/20 bg-sky-500/5 px-2.5 py-1.5 text-[11px] text-sky-300">
            <div className="flex items-center gap-1.5 font-medium">
              <ShieldCheck className="size-3.5 text-sky-400 shrink-0" />
              <span>Modo Solo Lectura M0 (Solo Proyecciones)</span>
            </div>
            <p className="mt-0.5 text-[10px] text-sky-300/80">
              Autoridad exclusiva en el motor Python (127.0.0.1:8765). Cero inferencias ni
              mutaciones desde la interfaz.
            </p>
          </div>

          {/* Body Content */}
          {status === 'ONLINE' ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between text-[11px] font-medium text-muted-foreground">
                <span>Proyectos Registrados ({projects.length})</span>
                <span className="text-[10px] font-mono text-zinc-500">ProjectStore</span>
              </div>
              {projects.length === 0 ? (
                <div className="rounded border border-dashed border-border/60 p-3 text-center text-xs text-muted-foreground">
                  No hay proyectos registrados en el motor local.
                </div>
              ) : (
                <div className="scrollbar-sleek flex max-h-48 flex-col gap-1.5 overflow-y-auto pr-0.5">
                  {projects.map((p) => (
                    <div
                      key={p.id}
                      className="flex items-center justify-between rounded-md border border-border/40 bg-card/60 px-2.5 py-1.5 text-xs transition-colors hover:bg-card"
                    >
                      <div className="flex flex-col truncate pr-2">
                        <span className="font-medium text-foreground truncate">{p.name}</span>
                        <span className="font-mono text-[10px] text-muted-foreground truncate">
                          {p.id}
                        </span>
                      </div>
                      <span className="shrink-0 rounded bg-secondary/80 px-1.5 py-0.5 text-[10px] font-mono text-secondary-foreground">
                        {p.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-md border border-amber-500/20 bg-amber-500/5 p-2.5 text-xs text-amber-200/90">
              <div className="flex items-center gap-1.5 font-medium text-amber-300">
                <ShieldAlert className="size-4 shrink-0" />
                <span>Motor Python Desconectado</span>
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-amber-200/80">
                Inicie el servidor orquestador con{' '}
                <code className="rounded bg-black/40 px-1 py-0.5 font-mono text-amber-100">
                  --staging-local
                </code>{' '}
                para sincronizar proyectos reales.
              </p>
              {errorMessage ? (
                <p
                  className="mt-1 font-mono text-[10px] text-zinc-400 truncate"
                  title={errorMessage}
                >
                  Detalle: {errorMessage}
                </p>
              ) : null}
              <p className="mt-1.5 text-[10px] text-zinc-400">
                Orca no inicia el motor automáticamente ni ejecuta tareas en segundo plano sin
                consentimiento humano.
              </p>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
