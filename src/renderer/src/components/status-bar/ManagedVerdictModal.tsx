import React, { useState } from 'react'
import { AlertCircle, Gavel, X } from 'lucide-react'
import {
  parseArchitectVerdictV1,
  type ArchitectVerdictV1,
  type ExpectedVerdictBinding
} from './ManagedVerdictValidation'
import {
  MANUAL_CHAT_OPTIONS,
  manualVerdictAuditMode,
  type ManualChatProvider
} from './ManagedChatProvider'

type Props = {
  readonly projectId: string
  readonly taskId: string
  readonly expectedContextSha?: string | null
  readonly expectedTaskSha?: string | null
  readonly expectedResultSha?: string | null
  readonly expectedRepoId?: string | null
  readonly expectedAttemptId?: string | null
  readonly chatProvider: ManualChatProvider
  readonly isOpen: boolean
  readonly onClose: () => void
  readonly onVerdictApplied: () => void
}

export function ManagedVerdictModal({
  projectId,
  taskId,
  expectedContextSha,
  expectedTaskSha,
  expectedResultSha,
  expectedRepoId,
  expectedAttemptId,
  chatProvider,
  isOpen,
  onClose,
  onVerdictApplied
}: Props): React.JSX.Element | null {
  const [rawJson, setRawJson] = useState('')
  const [operatorConfirmed, setOperatorConfirmed] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  if (!isOpen) {
    return null
  }

  const binding: ExpectedVerdictBinding = {
    projectId,
    taskId,
    repoId: expectedRepoId,
    taskSha: expectedTaskSha,
    resultSha: expectedResultSha,
    contextSha: expectedContextSha,
    attemptId: expectedAttemptId
  }
  const parsed = rawJson.trim() ? parseArchitectVerdictV1(rawJson, binding) : null
  const canSubmit = parsed?.ok === true && operatorConfirmed && !submitting

  async function handleSubmit() {
    if (!canSubmit || !parsed?.ok) {
      return
    }
    const verdict: ArchitectVerdictV1 = parsed.verdict
    setSubmitting(true)
    setSubmitError(null)
    try {
      // This is a manual provenance assertion, not cryptographic provider identity.
      // Python validates the full V1 packet, authorized session and durable evidence.
      const res = await window.api.managed.submitVerdict(
        projectId,
        verdict as unknown as Record<string, unknown>,
        manualVerdictAuditMode(chatProvider)
      )
      if (res.ok) {
        onVerdictApplied()
        onClose()
      } else {
        setSubmitError(res.error_message || 'El motor rechazó el veredicto.')
      }
    } catch (err: unknown) {
      setSubmitError(err instanceof Error ? err.message : 'Error al enviar el veredicto.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="flex w-full max-w-lg flex-col gap-3 rounded-lg border border-border bg-popover p-4 shadow-xl text-xs">
        <div className="flex items-center justify-between border-b border-border/40 pb-2">
          <div className="flex items-center gap-2 font-semibold text-foreground">
            <Gavel className="size-4 text-sky-400" />
            <span>Aplicar veredicto V1 — {MANUAL_CHAT_OPTIONS[chatProvider].label}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label="Cerrar veredicto"
            className="rounded p-1 text-muted-foreground hover:bg-accent"
          >
            <X className="size-3.5" />
          </button>
        </div>

        <p className="text-[10px] text-muted-foreground">
          Pegá el JSON íntegro de ArchitectVerdictV1 producido durante la revisión manual.
          El proveedor es declarado por el operador; Orcastrator no puede verificar quién
          escribió el texto. El backend comprobará también estados, hashes y evidencia.
        </p>

        <label htmlFor="managed-verdict-json" className="text-[11px] font-medium">
          ArchitectVerdictV1 completo
        </label>
        <textarea
          id="managed-verdict-json"
          value={rawJson}
          onChange={(event) => {
            setRawJson(event.target.value)
            setSubmitError(null)
            setOperatorConfirmed(false)
          }}
          rows={10}
          spellCheck={false}
          placeholder={'{"protocol_version":1,"kind":"verdict","project_id":"...","repo_id":"...","task_id":"...","task_sha256":"...","attempt_id":"...","result_sha256":"...","decision":"BLOCK","reason":"...","context_checkpoint_sha256":"...","architect_mode":"chat"}'}
          className="w-full rounded border border-border bg-background p-2 font-mono text-[10px] text-foreground focus:outline-none focus:ring-1 focus:ring-sky-500"
        />

        {parsed && !parsed.ok ? (
          <div className="flex items-start gap-1.5 rounded border border-rose-500/30 bg-rose-500/10 p-2 text-[10px] text-rose-300">
            <AlertCircle className="size-3 shrink-0" />
            <span>{parsed.error}</span>
          </div>
        ) : null}

        {parsed?.ok ? (
          <div className="rounded border border-sky-500/30 bg-sky-500/10 p-2 text-[10px] text-sky-200">
            Esquema preliminar válido: {parsed.verdict.decision}. La aceptación definitiva
            depende de las comprobaciones del motor y de la aprobación explícita.
          </div>
        ) : null}

        {(!expectedContextSha || !expectedTaskSha || !expectedRepoId) ? (
          <p className="text-[10px] text-amber-300">
            Hay identificadores de integridad no disponibles en esta vista.
            No se presume certificación; el motor debe validar el veredicto antes de aplicarlo.
          </p>
        ) : null}

        <label className="flex cursor-pointer items-start gap-2 text-[10px] text-muted-foreground">
          <input
            type="checkbox"
            checked={operatorConfirmed}
            onChange={(event) => setOperatorConfirmed(event.target.checked)}
            disabled={!parsed?.ok || submitting}
            className="mt-0.5 rounded border-border"
          />
          <span>
            Confirmo que seleccioné {MANUAL_CHAT_OPTIONS[chatProvider].label},
            revisé el resultado personalmente y autorizo aplicar este veredicto
            a la tarea seleccionada. No declaro que la identidad del chat esté verificada.
          </span>
        </label>

        {submitError ? (
          <div className="rounded border border-rose-500/30 bg-rose-500/10 p-2 text-[10px] text-rose-300">
            {submitError}
          </div>
        ) : null}

        <div className="flex justify-end gap-2 border-t border-border/40 pt-2">
          <button type="button" onClick={onClose} disabled={submitting}
            className="rounded px-2.5 py-1 text-muted-foreground hover:bg-accent text-[11px]">
            Cancelar
          </button>
          <button type="button" onClick={handleSubmit} disabled={!canSubmit}
            className="rounded bg-sky-600 px-3 py-1 font-medium text-white hover:bg-sky-500 disabled:opacity-50 text-[11px]">
            {submitting ? 'Validando...' : 'Aplicar con autorización manual'}
          </button>
        </div>
      </div>
    </div>
  )
}
