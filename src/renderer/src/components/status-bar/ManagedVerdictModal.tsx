import React, { useState } from 'react'
import { AlertCircle, CheckCircle2, Gavel, X } from 'lucide-react'

type Props = {
  readonly projectId: string
  readonly taskId: string
  readonly expectedContextSha?: string | null
  readonly isOpen: boolean
  readonly onClose: () => void
  readonly onVerdictApplied: () => void
}

type ParsedVerdict = {
  decision: string
  project_id: string
  task_id: string
  context_checkpoint_sha256: string
  notes?: string
}

export function ManagedVerdictModal({
  projectId,
  taskId,
  expectedContextSha,
  isOpen,
  onClose,
  onVerdictApplied
}: Props): React.JSX.Element | null {
  const [rawJson, setRawJson] = useState('')
  const [parsed, setParsed] = useState<ParsedVerdict | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)
  const [operatorConfirmed, setOperatorConfirmed] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitSuccess, setSubmitSuccess] = useState(false)

  if (!isOpen) {
    return null
  }

  function handleJsonChange(text: string) {
    setRawJson(text)
    setParseError(null)
    setSubmitError(null)
    if (!text.trim()) {
      setParsed(null)
      return
    }
    try {
      const obj = JSON.parse(text)
      const decision = String(obj.decision || '').toUpperCase()
      if (!['ACCEPT', 'REWORK', 'REJECT'].includes(decision)) {
        setParseError("Decisión inválida. Debe ser 'ACCEPT', 'REWORK' o 'REJECT'.")
        setParsed(null)
        return
      }
      if (obj.project_id && obj.project_id !== projectId) {
        setParseError(
          `Project ID ('${obj.project_id}') no coincide con el proyecto actual ('${projectId}').`
        )
        setParsed(null)
        return
      }
      if (obj.task_id && obj.task_id !== taskId) {
        setParseError(`Task ID ('${obj.task_id}') no coincide con la tarea actual ('${taskId}').`)
        setParsed(null)
        return
      }
      if (!obj.context_checkpoint_sha256 || obj.context_checkpoint_sha256 === 'NOT_AVAILABLE') {
        setParseError('El veredicto requiere un context_checkpoint_sha256 verificado.')
        setParsed(null)
        return
      }
      if (expectedContextSha && obj.context_checkpoint_sha256 !== expectedContextSha) {
        setParseError(
          `El context_checkpoint_sha256 ('${obj.context_checkpoint_sha256.slice(0, 12)}...') no coincide con el de la tarea ('${expectedContextSha.slice(0, 12)}...').`
        )
        setParsed(null)
        return
      }
      setParsed({
        decision,
        project_id: obj.project_id || projectId,
        task_id: obj.task_id || taskId,
        context_checkpoint_sha256: obj.context_checkpoint_sha256,
        notes: obj.notes || obj.reason || ''
      })
    } catch {
      setParseError('JSON inválido o malformado.')
      setParsed(null)
    }
  }

  async function handleSubmit() {
    if (!parsed || !operatorConfirmed) {
      return
    }
    setSubmitting(true)
    setSubmitError(null)
    try {
      const res = await window.api.managed.submitVerdict(projectId, {
        decision: parsed.decision,
        project_id: parsed.project_id,
        task_id: parsed.task_id,
        context_checkpoint_sha256: parsed.context_checkpoint_sha256,
        notes: parsed.notes
      })
      if (res.ok) {
        setSubmitSuccess(true)
        setTimeout(() => {
          onVerdictApplied()
          onClose()
        }, 1500)
      } else {
        setSubmitError(res.error_message || 'Fallo al aplicar el veredicto en el backend.')
      }
    } catch (err: unknown) {
      setSubmitError(err instanceof Error ? err.message : 'Error inesperado al aplicar veredicto.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="flex w-full max-w-md flex-col gap-3 rounded-lg border border-border bg-popover p-4 shadow-xl text-xs">
        <div className="flex items-center justify-between border-b border-border/40 pb-2">
          <div className="flex items-center gap-1.5 font-semibold text-foreground">
            <Gavel className="size-4 text-sky-400" />
            <span>Ingresar Veredicto del Arquitecto (ChatGPT)</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="verdict-json-input" className="text-[11px] font-medium text-foreground">
            Pegar JSON del ArchitectVerdictV1:
          </label>
          <textarea
            id="verdict-json-input"
            value={rawJson}
            onChange={(e) => handleJsonChange(e.target.value)}
            placeholder={`{ "decision": "ACCEPT", "project_id": "${projectId}", "task_id": "${taskId}", "context_checkpoint_sha256": "..." }`}
            rows={5}
            className="w-full rounded border border-border bg-background p-2 font-mono text-[10px] text-foreground focus:outline-none focus:ring-1 focus:ring-sky-500"
          />
        </div>

        {parseError ? (
          <div className="flex items-center gap-1.5 rounded bg-rose-500/10 p-2 text-[10px] text-rose-400 border border-rose-500/20">
            <AlertCircle className="size-3.5 shrink-0" />
            <span>{parseError}</span>
          </div>
        ) : null}

        {parsed ? (
          <div className="flex flex-col gap-1 rounded border border-sky-500/30 bg-sky-500/5 p-2 font-mono text-[10px]">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Decisión:</span>
              <span
                className={`font-semibold px-1.5 py-0.5 rounded text-[9px] ${
                  parsed.decision === 'ACCEPT'
                    ? 'bg-emerald-500/20 text-emerald-400'
                    : parsed.decision === 'REWORK'
                      ? 'bg-yellow-500/20 text-yellow-400'
                      : 'bg-rose-500/20 text-rose-400'
                }`}
              >
                {parsed.decision}
              </span>
            </div>
            <div className="truncate">
              <span className="text-muted-foreground">Context SHA:</span>{' '}
              <span className="text-foreground">
                {parsed.context_checkpoint_sha256.slice(0, 16)}...
              </span>
            </div>
          </div>
        ) : null}

        <label className="flex items-start gap-2 cursor-pointer pt-1 text-[10px] text-muted-foreground">
          <input
            type="checkbox"
            checked={operatorConfirmed}
            onChange={(e) => setOperatorConfirmed(e.target.checked)}
            className="mt-0.5 rounded border-border"
          />
          <span>
            Confirmo que este veredicto fue emitido legítimamente por ChatGPT GPT-6 y autorizo su
            aplicación.
          </span>
        </label>

        {submitError ? (
          <div className="rounded bg-rose-500/10 p-2 text-[10px] text-rose-400 border border-rose-500/20">
            {submitError}
          </div>
        ) : null}

        {submitSuccess ? (
          <div className="flex items-center gap-1.5 rounded bg-emerald-500/10 p-2 text-[10px] text-emerald-400 border border-emerald-500/20">
            <CheckCircle2 className="size-3.5 shrink-0" />
            <span>¡Veredicto aplicado exitosamente! Estado de tarea actualizado.</span>
          </div>
        ) : null}

        <div className="flex items-center justify-end gap-2 border-t border-border/40 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded px-2.5 py-1 text-muted-foreground hover:bg-accent text-[11px]"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!parsed || !operatorConfirmed || submitting || submitSuccess}
            className="rounded bg-sky-600 px-3 py-1 font-medium text-white hover:bg-sky-500 disabled:opacity-50 text-[11px]"
          >
            {submitting ? 'Aplicando...' : 'Aplicar Veredicto'}
          </button>
        </div>
      </div>
    </div>
  )
}
