import React, { useState, useEffect } from 'react'
import { Check, Copy, Download, Gavel, ShieldAlert, ShieldCheck } from 'lucide-react'
import type { ReviewPacketDTO } from './ManagedTaskDetailTypes'
import { computeSha256Hex, exportMarkdownFile } from './ManagedTaskDetailTypes'
import { ManagedVerdictModal } from './ManagedVerdictModal'

type Props = {
  readonly projectId: string
  readonly taskId: string
  readonly reviewPacket: ReviewPacketDTO | null
  readonly onVerdictApplied: () => void
}

export function ManagedReviewPacketView({
  projectId,
  taskId,
  reviewPacket,
  onVerdictApplied
}: Props): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState<string | null>(null)
  const [exported, setExported] = useState(false)
  const [computedSha, setComputedSha] = useState<string | null>(null)
  const [verdictModalOpen, setVerdictModalOpen] = useState(false)

  useEffect(() => {
    let active = true
    if (reviewPacket?.markdown_packet) {
      computeSha256Hex(reviewPacket.markdown_packet).then((hex) => {
        if (active) {
          setComputedSha(hex)
        }
      })
    } else {
      setComputedSha(null)
    }
    return () => {
      active = false
    }
  }, [reviewPacket?.markdown_packet])

  async function handleCopy() {
    if (!reviewPacket?.markdown_packet) {
      setCopyError('Sin paquete de revisión disponible para copiar.')
      return
    }
    const fullText = reviewPacket.markdown_packet
    try {
      await navigator.clipboard.writeText(fullText)
      setCopied(true)
      setCopyError(null)
      setTimeout(() => setCopied(false), 2000)
    } catch (err: unknown) {
      setCopyError(err instanceof Error ? err.message : 'Error al copiar al portapapeles.')
      setCopied(false)
    }
  }

  function handleExport() {
    if (!reviewPacket?.markdown_packet) {
      return
    }
    const fn = `review-packet-${projectId}-${taskId}.md`
    const ok = exportMarkdownFile(reviewPacket.markdown_packet, fn)
    if (ok) {
      setExported(true)
      setTimeout(() => setExported(false), 2000)
    }
  }

  if (!reviewPacket) {
    return (
      <div className="py-1 text-muted-foreground italic">Sin paquete de revisión disponible.</div>
    )
  }

  const shaMatches =
    computedSha &&
    reviewPacket.canonical_sha256 &&
    computedSha.toLowerCase() === reviewPacket.canonical_sha256.toLowerCase()

  const packetLength = reviewPacket.markdown_packet
    ? new TextEncoder().encode(reviewPacket.markdown_packet).length
    : 0

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <div className="flex flex-wrap items-center gap-1">
          <span className="rounded bg-sky-950/60 px-1.5 py-0.5 text-[9px] text-sky-400 font-mono">
            {reviewPacket.packet_status}
          </span>
          <span
            className={`rounded px-1.5 py-0.5 text-[9px] font-mono ${
              reviewPacket.provenance === 'AUTHENTIC'
                ? 'bg-emerald-950/60 text-emerald-400'
                : reviewPacket.provenance === 'SYNTHETIC'
                  ? 'bg-yellow-950/60 text-yellow-400'
                  : 'bg-amber-950/60 text-amber-400'
            }`}
          >
            {reviewPacket.provenance}
          </span>
          {shaMatches ? (
            <span className="rounded bg-emerald-950/40 px-1 py-0.5 text-[8.5px] text-emerald-300 font-mono inline-flex items-center gap-0.5">
              <ShieldCheck className="size-2.5" /> SHA VERIFIED
            </span>
          ) : (
            <span className="rounded bg-zinc-800 px-1 py-0.5 text-[8.5px] text-zinc-400 font-mono">
              {reviewPacket.hash_status}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleCopy}
            disabled={!reviewPacket.markdown_packet}
            className="inline-flex items-center gap-1 rounded bg-secondary px-2 py-0.5 font-mono text-[9px] text-secondary-foreground hover:bg-secondary/80 transition-colors"
            title={`Copiar íntegramente (${packetLength} bytes)`}
          >
            {copied ? (
              <Check className="size-2.5 text-emerald-400" />
            ) : (
              <Copy className="size-2.5" />
            )}
            <span>{copied ? 'Copiado!' : 'Copiar'}</span>
          </button>
          <button
            type="button"
            onClick={handleExport}
            disabled={!reviewPacket.markdown_packet}
            className="inline-flex items-center gap-1 rounded bg-secondary px-2 py-0.5 font-mono text-[9px] text-secondary-foreground hover:bg-secondary/80 transition-colors"
            title="Exportar archivo .md sin truncamiento"
          >
            {exported ? (
              <Check className="size-2.5 text-emerald-400" />
            ) : (
              <Download className="size-2.5" />
            )}
            <span>{exported ? 'Exportado!' : 'Exportar .md'}</span>
          </button>
        </div>
      </div>

      {copyError ? (
        <div className="rounded bg-rose-500/10 p-1.5 text-[9px] text-rose-300 border border-rose-500/20">
          {copyError} Utilice el botón &quot;Exportar .md&quot; para entrega completa.
        </div>
      ) : null}

      {reviewPacket.provenance === 'UNVERIFIED' ? (
        <div className="flex items-center gap-1 rounded border border-amber-500/30 bg-amber-950/20 px-2 py-1 text-[9px] text-amber-300">
          <ShieldAlert className="size-3 shrink-0 text-amber-400" />
          <span>Procedencia no verificada: commit o hash no contrastado en repositorio.</span>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-1 rounded bg-muted/20 p-1.5 font-mono text-[9px]">
        <div>
          <span className="text-muted-foreground">Base SHA:</span>{' '}
          <span className="text-foreground">{reviewPacket.base_sha?.slice(0, 10) || 'NONE'}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Result SHA:</span>{' '}
          <span className="text-foreground">{reviewPacket.result_sha?.slice(0, 10) || 'NONE'}</span>
        </div>
        <div className="col-span-2 truncate">
          <span className="text-muted-foreground">Signature:</span>{' '}
          <span className="text-foreground truncate">
            {reviewPacket.canonical_sha256 || 'NONE'}
          </span>
        </div>
        {computedSha ? (
          <div className="col-span-2 truncate">
            <span className="text-muted-foreground">Computed SHA-256:</span>{' '}
            <span className="text-foreground truncate">{computedSha}</span>
          </div>
        ) : null}
        <div>
          <span className="text-muted-foreground">Exit Code:</span>{' '}
          <span className="text-foreground">
            {reviewPacket.process_exit_code !== null ? reviewPacket.process_exit_code : 'N/A'}
          </span>
        </div>
        <div>
          <span className="text-muted-foreground">Verdict:</span>{' '}
          <span className="font-semibold text-sky-400">{reviewPacket.verdict || 'PENDING'}</span>
        </div>
      </div>

      <div className="flex items-center justify-between pt-1 border-t border-border/20">
        <span className="text-[9px] text-muted-foreground font-mono">
          Tamaño: {packetLength} bytes
        </span>
        <button
          type="button"
          onClick={() => setVerdictModalOpen(true)}
          className="inline-flex items-center gap-1 rounded bg-sky-600/30 hover:bg-sky-600/50 text-sky-300 border border-sky-500/40 px-2 py-0.5 text-[9px] font-medium transition-colors"
        >
          <Gavel className="size-2.5" />
          <span>Ingresar Veredicto (ChatGPT)</span>
        </button>
      </div>

      <ManagedVerdictModal
        projectId={projectId}
        taskId={taskId}
        expectedContextSha={reviewPacket.canonical_sha256}
        isOpen={verdictModalOpen}
        onClose={() => setVerdictModalOpen(false)}
        onVerdictApplied={onVerdictApplied}
      />
    </div>
  )
}
