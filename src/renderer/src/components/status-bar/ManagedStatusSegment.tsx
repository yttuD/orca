import React, { useCallback, useEffect, useState } from 'react'
import { Layers, RefreshCw, ShieldAlert, ShieldCheck } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ManagedEdgeBridgeHealth } from './ManagedEdgeBridgeHealth'
import { ManagedSupervisedRecoveryPanel } from './ManagedSupervisedRecoveryPanel'
import {
  ManagedProjectRow,
  type ManagedProject,
  type ManagedTask,
  type ManagedExecution
} from './ManagedProjectRow'

type ManagedStatus = 'ONLINE' | 'OFFLINE' | 'ERROR' | 'LOADING'

export function ManagedStatusSegment({
  iconOnly = false
}: {
  iconOnly?: boolean
}): React.JSX.Element {
  const [status, setStatus] = useState<ManagedStatus>('LOADING')
  const [projects, setProjects] = useState<readonly ManagedProject[]>([])
  const [errorCode, setErrorCode] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isOpen, setIsOpen] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [qaLifecycle, setQaLifecycle] = useState<{
    phase: string
    owner: string
    port: number | null
    restarts: number
    error_code?: string
  } | null>(null)

  // Selected project & task for inspection
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [tasks, setTasks] = useState<readonly ManagedTask[]>([])
  const [loadingTasks, setLoadingTasks] = useState(false)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [execution, setExecution] = useState<ManagedExecution | null>(null)
  const [loadingExecution, setLoadingExecution] = useState(false)

  const loadTasks = useCallback(async (projId: string) => {
    if (!window.api?.managed?.listTasks) {
      return
    }
    setLoadingTasks(true)
    try {
      const res = await window.api.managed.listTasks(projId)
      if (res.ok) {
        const tList = res.tasks || []
        setTasks(tList)
        if (tList.length > 0) {
          setSelectedTaskId(tList[0].id)
          if (window.api?.managed?.getExecution) {
            setLoadingExecution(true)
            const execRes = await window.api.managed.getExecution(projId, tList[0].id)
            if (execRes.ok && execRes.execution) {
              setExecution(execRes.execution)
            }
            setLoadingExecution(false)
          }
        }
      } else {
        setTasks([])
      }
    } catch {
      setTasks([])
    } finally {
      setLoadingTasks(false)
    }
  }, [])

  const loadExecution = useCallback(async (projId: string, taskId: string) => {
    if (!window.api?.managed?.getExecution) {
      return
    }
    setLoadingExecution(true)
    try {
      const res = await window.api.managed.getExecution(projId, taskId)
      if (res.ok && res.execution) {
        setExecution(res.execution)
      } else {
        setExecution(null)
      }
    } catch {
      setExecution(null)
    } finally {
      setLoadingExecution(false)
    }
  }, [])

  const fetchStatus = useCallback(async () => {
    setRefreshing(true)
    try {
      if (window.api?.managed?.qaEngineLifecycle) {
        const lifecycle = await window.api.managed.qaEngineLifecycle().catch(() => null)
        if (lifecycle) setQaLifecycle(lifecycle)
      }
      if (!window.api?.managed?.listProjects) {
        setStatus('OFFLINE')
        setErrorCode('BRIDGE_UNAVAILABLE')
        setErrorMessage('Bridge managed no disponible en este entorno.')
        setProjects([])
        return
      }
      const res = await window.api.managed.listProjects()
      if (res.ok && res.status === 'ONLINE') {
        setStatus('ONLINE')
        const projs = res.projects || []
        setProjects(projs)
        setErrorCode(null)
        setErrorMessage(null)
        if (projs.length > 0) {
          setSelectedProjectId(projs[0].id)
          loadTasks(projs[0].id)
        }
      } else if (res.status === 'OFFLINE') {
        setStatus('OFFLINE')
        setProjects([])
        setTasks([])
        setExecution(null)
        setSelectedProjectId(null)
        setSelectedTaskId(null)
        setErrorCode(res.error_code || 'ENGINE_OFFLINE')
        setErrorMessage(res.error_message || 'Motor Python desconectado')
      } else {
        setStatus('ERROR')
        setProjects([])
        setTasks([])
        setExecution(null)
        setSelectedProjectId(null)
        setSelectedTaskId(null)
        setErrorCode(res.error_code || 'RPC_ERROR')
        setErrorMessage(res.error_message || 'Error en respuesta RPC')
      }
    } catch (err: unknown) {
      setStatus('OFFLINE')
      setProjects([])
      setTasks([])
      setExecution(null)
      setSelectedProjectId(null)
      setSelectedTaskId(null)
      setErrorCode('CONN_FAIL')
      setErrorMessage(err instanceof Error ? err.message : 'Fallo de conexión al motor')
    } finally {
      setRefreshing(false)
    }
  }, [loadTasks])

  // A QA child can become ready *after* the renderer's first OFFLINE
  // request. Poll faster only while that disposable child is starting or
  // recovering; retain the normal 15-second cadence otherwise.
  const qaPhase = qaLifecycle?.phase
  useEffect(() => {
    fetchStatus()
    const qaNeedsReconnect =
      qaPhase !== undefined &&
      qaPhase !== 'DISABLED' &&
      status !== 'ONLINE'
    const interval = setInterval(fetchStatus, qaNeedsReconnect ? 1500 : 15000)
    return () => clearInterval(interval)
  }, [fetchStatus, qaPhase, status])

  const handleSelectProject = (projId: string) => {
    if (selectedProjectId === projId) {
      setSelectedProjectId(null)
      setTasks([])
      setSelectedTaskId(null)
      setExecution(null)
    } else {
      setSelectedProjectId(projId)
      setSelectedTaskId(null)
      setExecution(null)
      loadTasks(projId)
    }
  }

  const handleSelectTask = (taskId: string) => {
    if (!selectedProjectId) {
      return
    }
    if (selectedTaskId === taskId) {
      setSelectedTaskId(null)
      setExecution(null)
    } else {
      setSelectedTaskId(taskId)
      loadExecution(selectedProjectId, taskId)
    }
  }

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
        className="w-96 rounded-lg border border-border/60 bg-popover/95 p-3.5 shadow-xl backdrop-blur-md"
      >
        <div className="flex flex-col gap-3">
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

          <ManagedEdgeBridgeHealth />

          {qaLifecycle && qaLifecycle.phase !== 'DISABLED' ? (
            <div className="rounded border border-amber-500/25 bg-amber-500/5 px-2.5 py-1.5 text-[11px]">
              <div className="font-medium text-amber-300">
                Motor QA administrado: {qaLifecycle.phase}
              </div>
              <p className="mt-1 text-[10px] text-muted-foreground">
                Instancia desechable {qaLifecycle.owner === 'THIS_ELECTRON' ? 'propiedad de Electron' : 'sin proceso propio'}.
                {qaLifecycle.port ? ` Puerto local ${qaLifecycle.port}.` : ''}
                {qaLifecycle.restarts > 0 ? ` Recuperaciones: ${qaLifecycle.restarts}.` : ''}
                {qaLifecycle.error_code ? ` Código: ${qaLifecycle.error_code}.` : ''}
                {' '}No conecta el motor operativo.
              </p>
            </div>
          ) : null}

          {qaLifecycle && qaLifecycle.phase !== 'DISABLED' ? (
            <ManagedSupervisedRecoveryPanel qaLifecycle={qaLifecycle} />
          ) : null}

          <div className="rounded border border-sky-500/20 bg-sky-500/5 px-2.5 py-1.5 text-[11px] text-sky-300">
            <div className="flex items-center gap-1.5 font-medium">
              <ShieldCheck className="size-3.5 text-sky-400 shrink-0" />
              <span>Gestión Desktop con autorización local</span>
            </div>
            <p className="mt-0.5 text-[10px] text-sky-300/80">
              El motor Python conserva la autoridad. Las acciones requieren autorización local;
              el feed Edge es solo lectura y el modo QA no modifica procesos operativos.
            </p>
          </div>

          {status === 'ONLINE' ? (
            <div className="flex flex-col gap-2.5">
              <div className="flex items-center justify-between text-[11px] font-medium text-muted-foreground">
                <span>Proyectos Registrados ({projects.length})</span>
                <span className="text-[10px] font-mono text-zinc-500">ProjectStore</span>
              </div>
              {projects.length === 0 ? (
                <div className="rounded border border-dashed border-border/60 p-3 text-center text-xs text-muted-foreground">
                  No hay proyectos registrados en el motor local.
                </div>
              ) : (
                <div className="scrollbar-sleek flex max-h-56 flex-col gap-1.5 overflow-y-auto pr-0.5">
                  {projects.map((p) => (
                    <ManagedProjectRow
                      key={p.id}
                      project={p}
                      isSelected={selectedProjectId === p.id}
                      tasks={tasks}
                      loadingTasks={loadingTasks}
                      selectedTaskId={selectedTaskId}
                      execution={execution}
                      loadingExecution={loadingExecution}
                      onSelectProject={handleSelectProject}
                      onSelectTask={handleSelectTask}
                      onRefreshTasks={() => {
                        if (selectedProjectId) {
                          loadTasks(selectedProjectId)
                        }
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-md border border-amber-500/20 bg-amber-500/5 p-2.5 text-xs text-amber-200/90">
              <div className="flex items-center gap-1.5 font-medium text-amber-300">
                <ShieldAlert className="size-4 shrink-0" />
                <span>
                  {status === 'ERROR'
                    ? `Error de Conexión (${errorCode || 'ERROR'})`
                    : 'Motor Python Desconectado'}
                </span>
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-amber-200/80">
                {status === 'ERROR' && errorCode === 'AUTH_REQUIRED'
                  ? 'El puente local requiere autenticación. Verifique que .operator_token exista o ORCHESTRATOR_TOKEN esté configurado.'
                  : 'No hay conexión con el motor administrado. Verifique su estado y perfil antes de habilitar datos reales.'}
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
