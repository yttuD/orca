import React, { useState } from 'react'
import { ChevronDown, ChevronRight, ListTodo, Play, RefreshCw, Terminal } from 'lucide-react'
import { ManagedTaskDetailCard } from './ManagedTaskDetailCard'
import { ManagedDraftsSection } from './ManagedDraftsSection'

export type ManagedProject = {
  readonly id: string
  readonly name: string
  readonly description?: string | null
  readonly status: string
  readonly mode: string
  readonly created_at?: string | null
  readonly updated_at?: string | null
}

export type ManagedTask = {
  readonly id: string
  readonly project_id: string
  readonly title: string
  readonly status: string
  readonly executor: string
  readonly created_at?: string | null
  readonly updated_at?: string | null
}

export type ManagedExecution = {
  readonly task_id: string
  readonly project_id: string
  readonly status: string
  readonly executor: string
  readonly attempt_id?: string | null
  readonly lease_owner: string
  readonly lease_generation: number
  readonly last_activity?: string | null
  readonly verdict?: string | null
}

type Props = {
  project: ManagedProject
  isSelected: boolean
  tasks: readonly ManagedTask[]
  loadingTasks: boolean
  selectedTaskId: string | null
  execution: ManagedExecution | null
  loadingExecution: boolean
  onSelectProject: (id: string) => void
  onSelectTask: (taskId: string) => void
  onRefreshTasks?: () => void
}

export function ManagedProjectRow({
  project: p,
  isSelected,
  tasks,
  loadingTasks,
  selectedTaskId,
  execution,
  loadingExecution,
  onSelectProject,
  onSelectTask,
  onRefreshTasks
}: Props): React.JSX.Element {
  const [dispatchingTaskId, setDispatchingTaskId] = useState<string | null>(null)
  const [consentingTaskId, setConsentingTaskId] = useState<string | null>(null)
  const [lastConsentTaskId, setLastConsentTaskId] = useState<string | null>(null)
  const [dispatchError, setDispatchError] = useState<string | null>(null)

  async function handleInferenceConsent(task: ManagedTask) {
    setConsentingTaskId(task.id)
    setDispatchError(null)
    try {
      const result = await window.api.managed.authorizeInference(
        p.id,
        task.id,
        task.executor
      )
      if (result.ok) {
        setLastConsentTaskId(task.id)
      } else {
        setDispatchError(result.error_message || 'El motor no autorizó inferencia.')
      }
    } catch (err: unknown) {
      setDispatchError(err instanceof Error ? err.message : 'Fallo el consentimiento.')
    } finally {
      setConsentingTaskId(null)
    }
  }

  async function handleDispatch(taskId: string) {
    setDispatchingTaskId(taskId)
    setDispatchError(null)
    try {
      const res = await window.api.managed.dispatchTask(p.id, taskId)
      if (res.ok) {
        if (onRefreshTasks) {
          onRefreshTasks()
        }
      } else {
        setDispatchError(res.error_message || 'Fallo al despachar la tarea.')
      }
    } catch (err: unknown) {
      setDispatchError(err instanceof Error ? err.message : 'Error al despachar tarea.')
    } finally {
      setDispatchingTaskId(null)
    }
  }

  return (
    <div className="flex flex-col rounded-md border border-border/40 bg-card/60 transition-colors">
      <div
        role="button"
        tabIndex={0}
        onClick={() => onSelectProject(p.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            onSelectProject(p.id)
          }
        }}
        className="flex cursor-pointer items-center justify-between px-2.5 py-1.5 text-xs hover:bg-card"
      >
        <div className="flex items-center gap-1.5 truncate pr-2">
          {isSelected ? (
            <ChevronDown className="size-3.5 text-muted-foreground shrink-0" />
          ) : (
            <ChevronRight className="size-3.5 text-muted-foreground shrink-0" />
          )}
          <div className="flex flex-col truncate">
            <span className="font-medium text-foreground truncate">{p.name}</span>
            <span className="font-mono text-[9px] text-muted-foreground truncate">{p.id}</span>
          </div>
        </div>
        <span className="shrink-0 rounded bg-secondary/80 px-1.5 py-0.5 text-[10px] font-mono text-secondary-foreground">
          {p.status}
        </span>
      </div>

      {isSelected ? (
        <div className="border-t border-border/30 bg-muted/20 p-2 flex flex-col gap-2">
          <div className="flex items-center justify-between text-[10px] font-medium text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <ListTodo className="size-3 text-sky-400" />
              <span>Tareas ({tasks.length})</span>
            </span>
            {loadingTasks ? (
              <RefreshCw className="size-3 animate-spin text-muted-foreground" />
            ) : null}
          </div>

          {dispatchError ? (
            <div className="rounded bg-rose-500/10 p-1.5 text-[9px] text-rose-300 border border-rose-500/20">
              {dispatchError}
            </div>
          ) : null}

          {tasks.length === 0 && !loadingTasks ? (
            <div className="text-[10px] text-muted-foreground italic pl-1">
              Sin tareas registradas en este proyecto.
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              {tasks.map((t) => {
                const isTaskSelected = selectedTaskId === t.id
                const isQueued = t.status === 'QUEUED'
                const isDispatching = dispatchingTaskId === t.id
                const isConsenting = consentingTaskId === t.id
                return (
                  <div
                    key={t.id}
                    className="flex flex-col rounded border border-border/30 bg-background/50 text-[11px]"
                  >
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => onSelectTask(t.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          onSelectTask(t.id)
                        }
                      }}
                      className="flex cursor-pointer items-center justify-between px-2 py-1 hover:bg-accent/40"
                    >
                      <div className="flex items-center gap-1.5 truncate pr-1">
                        <Terminal className="size-3 text-zinc-400 shrink-0" />
                        <span className="font-medium truncate">{t.title}</span>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {isQueued ? (
                          <>
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation()
                                handleInferenceConsent(t)
                              }}
                              disabled={isConsenting || isDispatching}
                              className="inline-flex items-center gap-0.5 rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-medium text-amber-300 hover:bg-amber-500/20 disabled:opacity-50"
                              title="Autorizar inferencia separadamente; puede consumir cuota o generar costos"
                            >
                              <span>{isConsenting ? '...' : lastConsentTaskId === t.id ? 'Consentimiento enviado' : 'Autorizar inferencia'}</span>
                            </button>
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation()
                                handleDispatch(t.id)
                              }}
                              disabled={isDispatching || isConsenting}
                              className="inline-flex items-center gap-0.5 rounded bg-sky-600 px-1.5 py-0.5 text-[9px] font-medium text-white hover:bg-sky-500 disabled:opacity-50"
                              title="Solicitar despacho; el motor debe comprobar consentimiento durable, supervisor y Job Object"
                            >
                              <Play className="size-2.5" />
                              <span>{isDispatching ? '...' : 'Solicitar despacho'}</span>
                            </button>
                          </>
                        ) : null}
                        <span className="font-mono text-[9px] text-sky-300 bg-sky-500/10 px-1 rounded">
                          {t.status}
                        </span>
                      </div>
                    </div>

                    {isTaskSelected ? (
                      <div className="border-t border-border/20 bg-background/80 p-2 text-[10px] flex flex-col gap-1">
                        {loadingExecution ? (
                          <div className="flex items-center gap-1 text-muted-foreground">
                            <RefreshCw className="size-3 animate-spin" />
                            <span>Cargando ejecución...</span>
                          </div>
                        ) : execution ? (
                          <div className="grid grid-cols-2 gap-1 font-mono text-[9px]">
                            <div>
                              <span className="text-muted-foreground">Lease Owner:</span>{' '}
                              <span className="text-foreground">{execution.lease_owner}</span>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Generation:</span>{' '}
                              <span className="text-foreground">{execution.lease_generation}</span>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Executor:</span>{' '}
                              <span className="text-foreground">{execution.executor}</span>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Attempt:</span>{' '}
                              <span className="text-foreground">
                                {execution.attempt_id || 'NONE'}
                              </span>
                            </div>
                            {execution.verdict ? (
                              <div className="col-span-2">
                                <span className="text-muted-foreground">Verdict:</span>{' '}
                                <span className="text-foreground font-semibold">
                                  {execution.verdict}
                                </span>
                              </div>
                            ) : null}
                          </div>
                        ) : (
                          <div className="text-muted-foreground italic">
                            Sin datos de ejecución disponibles.
                          </div>
                        )}
                        <ManagedTaskDetailCard
                          projectId={p.id}
                          taskId={t.id}
                          onStateChanged={onRefreshTasks}
                        />
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
          )}

          <ManagedDraftsSection
            projectId={p.id}
            projectMode={p.mode}
            onTaskCreatedOrChanged={() => {
              if (onRefreshTasks) {
                onRefreshTasks()
              }
            }}
          />
        </div>
      ) : null}
    </div>
  )
}
