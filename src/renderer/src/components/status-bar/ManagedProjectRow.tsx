import React from 'react'
import { ChevronDown, ChevronRight, ListTodo, RefreshCw, Terminal } from 'lucide-react'
import { ManagedTaskDetailCard } from './ManagedTaskDetailCard'

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
  onSelectTask
}: Props): React.JSX.Element {
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
        <div className="border-t border-border/30 bg-muted/20 p-2 flex flex-col gap-1.5">
          <div className="flex items-center justify-between text-[10px] font-medium text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <ListTodo className="size-3 text-sky-400" />
              <span>Tareas ({tasks.length})</span>
            </span>
            {loadingTasks ? (
              <RefreshCw className="size-3 animate-spin text-muted-foreground" />
            ) : null}
          </div>

          {tasks.length === 0 && !loadingTasks ? (
            <div className="text-[10px] text-muted-foreground italic pl-1">
              Sin tareas registradas en este proyecto.
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              {tasks.map((t) => {
                const isTaskSelected = selectedTaskId === t.id
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
                      <span className="shrink-0 font-mono text-[9px] text-sky-300 bg-sky-500/10 px-1 rounded">
                        {t.status}
                      </span>
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
                        <ManagedTaskDetailCard projectId={p.id} taskId={t.id} />
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}
