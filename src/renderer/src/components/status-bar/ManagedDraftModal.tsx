import React, { useState } from 'react'
import { AlertCircle, FilePlus, X } from 'lucide-react'

type Props = {
  readonly projectId: string
  readonly projectMode?: string
  readonly isOpen: boolean
  readonly onClose: () => void
  readonly onDraftCreated: () => void
}

export function ManagedDraftModal({
  projectId,
  projectMode = 'BOTH',
  isOpen,
  onClose,
  onDraftCreated
}: Props): React.JSX.Element | null {
  const [title, setTitle] = useState('')
  const [instructions, setInstructions] = useState('')
  const [executor, setExecutor] = useState<'codex' | 'antigravity'>(
    projectMode.toLowerCase() === 'antigravity' ? 'antigravity' : 'codex'
  )
  const [baseRef, setBaseRef] = useState('refs/heads/main')
  const [baseSha, setBaseSha] = useState('')
  const [requestedChecks, setRequestedChecks] = useState('check_syntax, test_smoke')
  const [maxRuntimeSeconds, setMaxRuntimeSeconds] = useState(600)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!isOpen) {
    return null
  }

  async function handleSave() {
    if (!title.trim() || !instructions.trim()) {
      setError('El título y las instrucciones son obligatorios.')
      return
    }
    if (!/^[0-9a-f]{40}$/i.test(baseSha.trim()) || /^0{40}$/.test(baseSha.trim())) {
      setError('Ingresá el SHA real de 40 caracteres del commit base (no se admiten ceros ni valores ficticios).')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const checks = requestedChecks
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      const res = await window.api.managed.createDraft(projectId, {
        title: title.trim(),
        instructions: instructions.trim(),
        executor,
        model: executor === 'codex' ? 'default' : 'gemini-3.8-flash-medium',
        base_ref: baseRef.trim(),
        base_sha: baseSha.trim(),
        requested_checks: checks,
        max_runtime_seconds: maxRuntimeSeconds
      })
      if (res.ok) {
        onDraftCreated()
        onClose()
      } else {
        setError(res.error_message || 'Fallo al guardar el borrador.')
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error inesperado al crear borrador.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="flex w-full max-w-md flex-col gap-3 rounded-lg border border-border bg-popover p-4 shadow-xl text-xs">
        <div className="flex items-center justify-between border-b border-border/40 pb-2">
          <div className="flex items-center gap-1.5 font-semibold text-foreground">
            <FilePlus className="size-4 text-sky-400" />
            <span>Crear Borrador de Tarea</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        </div>

        <div className="flex flex-col gap-2">
          <div>
            <label
              htmlFor="draft-title-input"
              className="text-[10px] font-medium text-muted-foreground"
            >
              Título:
            </label>
            <input
              id="draft-title-input"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ej: Implementar validación de contratos"
              className="mt-0.5 w-full rounded border border-border bg-background px-2 py-1 text-foreground focus:outline-none focus:ring-1 focus:ring-sky-500"
            />
          </div>

          <div>
            <label
              htmlFor="draft-instructions-input"
              className="text-[10px] font-medium text-muted-foreground"
            >
              Instrucciones detalladas:
            </label>
            <textarea
              id="draft-instructions-input"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="Describa el objetivo, archivos a tocar y comportamiento esperado..."
              rows={3}
              className="mt-0.5 w-full rounded border border-border bg-background p-2 text-foreground focus:outline-none focus:ring-1 focus:ring-sky-500 text-[11px]"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label
                htmlFor="draft-executor-select"
                className="text-[10px] font-medium text-muted-foreground"
              >
                Ejecutor:
              </label>
              <select
                id="draft-executor-select"
                value={executor}
                onChange={(e) => setExecutor(e.target.value as 'codex' | 'antigravity')}
                className="mt-0.5 w-full rounded border border-border bg-background px-2 py-1 text-foreground focus:outline-none focus:ring-1 focus:ring-sky-500"
              >
                <option value="codex">Codex</option>
                <option value="antigravity">Antigravity</option>
              </select>
            </div>
            <div>
              <label
                htmlFor="draft-base-ref-input"
                className="text-[10px] font-medium text-muted-foreground"
              >
                Rama Base:
              </label>
              <input
                id="draft-base-ref-input"
                type="text"
                value={baseRef}
                onChange={(e) => setBaseRef(e.target.value)}
                className="mt-0.5 w-full rounded border border-border bg-background px-2 py-1 text-foreground focus:outline-none focus:ring-1 focus:ring-sky-500 font-mono text-[10px]"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="draft-base-sha-input" className="text-[10px] font-medium text-muted-foreground">
              Commit base (SHA Git de 40 caracteres, real y verificable)
            </label>
            <input
              id="draft-base-sha-input"
              type="text"
              value={baseSha}
              onChange={(e) => setBaseSha(e.target.value)}
              placeholder="Pegá el SHA completo de la rama base"
              spellCheck={false}
              className="w-full rounded border border-border bg-background px-2 py-1 text-foreground font-mono text-[10px]"
            />
            <span className="text-[9px] text-muted-foreground">
              Obligatorio para preparar TaskEnvelopeV1; el motor comprobará commit, rama y ContextManifest.
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label
                htmlFor="draft-checks-input"
                className="text-[10px] font-medium text-muted-foreground"
              >
                Checks solicitados:
              </label>
              <input
                id="draft-checks-input"
                type="text"
                value={requestedChecks}
                onChange={(e) => setRequestedChecks(e.target.value)}
                className="mt-0.5 w-full rounded border border-border bg-background px-2 py-1 text-foreground focus:outline-none focus:ring-1 focus:ring-sky-500 font-mono text-[10px]"
              />
            </div>
            <div>
              <label
                htmlFor="draft-timeout-input"
                className="text-[10px] font-medium text-muted-foreground"
              >
                Timeout (segundos):
              </label>
              <input
                id="draft-timeout-input"
                type="number"
                value={maxRuntimeSeconds}
                onChange={(e) => setMaxRuntimeSeconds(Number(e.target.value))}
                className="mt-0.5 w-full rounded border border-border bg-background px-2 py-1 text-foreground focus:outline-none focus:ring-1 focus:ring-sky-500"
              />
            </div>
          </div>
        </div>

        {error ? (
          <div className="flex items-center gap-1.5 rounded bg-rose-500/10 p-2 text-[10px] text-rose-400 border border-rose-500/20">
            <AlertCircle className="size-3.5 shrink-0" />
            <span>{error}</span>
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
            onClick={handleSave}
            disabled={saving}
            className="rounded bg-sky-600 px-3 py-1 font-medium text-white hover:bg-sky-500 disabled:opacity-50 text-[11px]"
          >
            {saving ? 'Guardando...' : 'Guardar Borrador'}
          </button>
        </div>
      </div>
    </div>
  )
}
