import React, { useState, useEffect, useCallback } from 'react'
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileCode,
  FilePlus,
  Play,
  RefreshCw,
  ShieldCheck
} from 'lucide-react'
import { ManagedDraftModal } from './ManagedDraftModal'

export type ManagedDraft = {
  readonly draft_id: string
  readonly project_id: string
  readonly title: string
  readonly description: string
  readonly executor: string
  readonly state: string
  readonly envelope?: Record<string, unknown> | null
  readonly envelope_sha256?: string | null
  readonly task_id?: string | null
  readonly requested_checks?: readonly string[]
  readonly created_at?: string | null
}

type Props = {
  readonly projectId: string
  readonly projectMode?: string
  readonly onTaskCreatedOrChanged: () => void
}

export function ManagedDraftsSection({
  projectId,
  projectMode,
  onTaskCreatedOrChanged
}: Props): React.JSX.Element {
  const [drafts, setDrafts] = useState<readonly ManagedDraft[]>([])
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [expandedDraftId, setExpandedDraftId] = useState<string | null>(null)
  const [actionInProgress, setActionInProgress] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const loadDrafts = useCallback(async () => {
    if (!window.api?.managed?.listDrafts) {
      return
    }
    setLoading(true)
    try {
      const res = await window.api.managed.listDrafts(projectId)
      if (res.ok && Array.isArray(res.drafts)) {
        setDrafts(res.drafts as readonly ManagedDraft[])
      } else {
        setDrafts([])
      }
    } catch {
      setDrafts([])
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    loadDrafts()
  }, [loadDrafts])

  async function handlePrepare(draftId: string) {
    setActionInProgress(draftId)
    setActionError(null)
    try {
      const res = await window.api.managed.prepareDraft(projectId, draftId)
      if (res.ok) {
        await loadDrafts()
      } else {
        setActionError(res.error_message || 'Fallo al preparar el borrador.')
      }
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Error al preparar borrador.')
    } finally {
      setActionInProgress(null)
    }
  }

  async function handleApprove(draftId: string) {
    setActionInProgress(draftId)
    setActionError(null)
    try {
      const res = await window.api.managed.approveDraft(
        projectId,
        draftId,
        'Aprobado manualmente por operador Windows vía Orca Desktop.'
      )
      if (res.ok) {
        await loadDrafts()
        onTaskCreatedOrChanged()
      } else {
        setActionError(res.error_message || 'Fallo al aprobar y encolar borrador.')
      }
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Error al aprobar borrador.')
    } finally {
      setActionInProgress(null)
    }
  }

  return (
    <div className="flex flex-col gap-1.5 border-t border-border/20 pt-1.5 text-[10px]">
      <div className="flex items-center justify-between font-medium text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <FileCode className="size-3 text-sky-400" />
          <span>Borradores ({drafts.length})</span>
        </span>
        <div className="flex items-center gap-1">
          {loading ? <RefreshCw className="size-2.5 animate-spin text-muted-foreground" /> : null}
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="inline-flex items-center gap-0.5 rounded bg-sky-600/30 px-1.5 py-0.5 text-[9px] font-medium text-sky-300 hover:bg-sky-600/50 transition-colors"
          >
            <FilePlus className="size-2.5" />
            <span>Nuevo Borrador</span>
          </button>
        </div>
      </div>

      {actionError ? (
        <div className="rounded bg-rose-500/10 p-1.5 text-[9px] text-rose-300 border border-rose-500/20">
          {actionError}
        </div>
      ) : null}

      {drafts.length === 0 && !loading ? (
        <div className="text-[9px] text-muted-foreground italic pl-1">
          No hay borradores creados en este proyecto.
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          {drafts.map((d) => {
            const isExpanded = expandedDraftId === d.draft_id
            const isPrepared = d.state === 'PREPARED'
            const isDraft = d.state === 'DRAFT'
            const isProcessing = actionInProgress === d.draft_id
            return (
              <div
                key={d.draft_id}
                className="flex flex-col rounded border border-border/30 bg-background/50"
              >
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setExpandedDraftId(isExpanded ? null : d.draft_id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      setExpandedDraftId(isExpanded ? null : d.draft_id)
                    }
                  }}
                  className="flex cursor-pointer items-center justify-between px-2 py-1 hover:bg-accent/40"
                >
                  <div className="flex items-center gap-1.5 truncate pr-1">
                    {isExpanded ? (
                      <ChevronDown className="size-2.5 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="size-2.5 text-muted-foreground" />
                    )}
                    <span className="font-medium truncate">{d.title}</span>
                  </div>
                  <span
                    className={`shrink-0 font-mono text-[8.5px] px-1 rounded ${
                      isPrepared
                        ? 'bg-amber-500/15 text-amber-300'
                        : isDraft
                          ? 'bg-zinc-500/15 text-zinc-300'
                          : 'bg-emerald-500/15 text-emerald-300'
                    }`}
                  >
                    {d.state}
                  </span>
                </div>

                {isExpanded ? (
                  <div className="border-t border-border/20 bg-background/80 p-2 text-[9px] flex flex-col gap-1.5">
                    <p className="text-muted-foreground leading-relaxed">{d.description}</p>
                    <div className="grid grid-cols-2 gap-1 font-mono text-[8.5px] rounded bg-muted/20 p-1">
                      <div>
                        <span className="text-muted-foreground">Ejecutor:</span> {d.executor}
                      </div>
                      <div>
                        <span className="text-muted-foreground">Draft ID:</span>{' '}
                        {d.draft_id.slice(0, 8)}...
                      </div>
                    </div>

                    {isPrepared && d.envelope ? (
                      <div className="flex flex-col gap-0.5 rounded border border-amber-500/30 bg-amber-950/10 p-1.5 font-mono text-[8.5px]">
                        <div className="flex items-center gap-1 text-amber-300 font-semibold">
                          <ShieldCheck className="size-3" />
                          <span>TaskEnvelopeV1 Preparado</span>
                        </div>
                        <div className="truncate">
                          <span className="text-muted-foreground">Envelope SHA-256:</span>{' '}
                          {String(d.envelope_sha256 || '').slice(0, 16)}...
                        </div>
                        <div className="truncate">
                          <span className="text-muted-foreground">Context SHA:</span>{' '}
                          {String(d.envelope.context_checkpoint_sha256 || '').slice(0, 16)}...
                        </div>
                        <div className="truncate">
                          <span className="text-muted-foreground">Base SHA:</span>{' '}
                          {String(d.envelope.base_sha || '').slice(0, 16)}...
                        </div>
                      </div>
                    ) : null}

                    <div className="flex items-center justify-end gap-1.5 pt-1">
                      {isDraft ? (
                        <button
                          type="button"
                          onClick={() => handlePrepare(d.draft_id)}
                          disabled={isProcessing}
                          className="inline-flex items-center gap-1 rounded bg-secondary px-2 py-0.5 font-medium text-secondary-foreground hover:bg-secondary/80 disabled:opacity-50"
                        >
                          <Play className="size-2.5" />
                          <span>{isProcessing ? 'Preparando...' : 'Preparar'}</span>
                        </button>
                      ) : null}

                      {isPrepared ? (
                        <button
                          type="button"
                          onClick={() => handleApprove(d.draft_id)}
                          disabled={isProcessing}
                          className="inline-flex items-center gap-1 rounded bg-emerald-600 px-2 py-0.5 font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
                        >
                          <CheckCircle2 className="size-2.5" />
                          <span>{isProcessing ? 'Aprobando...' : 'Aprobar y Encolar'}</span>
                        </button>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      )}

      <ManagedDraftModal
        projectId={projectId}
        projectMode={projectMode}
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onDraftCreated={() => {
          loadDrafts()
          onTaskCreatedOrChanged()
        }}
      />
    </div>
  )
}
