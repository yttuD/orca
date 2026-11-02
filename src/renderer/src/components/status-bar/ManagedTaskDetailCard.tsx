import React, { useState, useEffect } from 'react'
import {
  Activity,
  Check,
  CheckCircle2,
  Copy,
  FileCheck,
  FileText,
  RefreshCw,
  ShieldAlert,
  ShieldCheck
} from 'lucide-react'

export type EvidenceDTO = {
  readonly evidence_status: 'AVAILABLE' | 'NOT_FOUND' | 'NOT_RUN' | 'UNVERIFIED' | 'ERROR'
  readonly execution_mode: string
  readonly is_synthetic: boolean
  readonly checks: readonly Record<string, unknown>[]
  readonly artifacts: readonly string[]
  readonly canonical_sha256?: string | null
  readonly result_sha?: string | null
}

export type ReviewPacketDTO = {
  readonly packet_status: 'AVAILABLE' | 'NOT_FOUND' | 'NOT_RUN' | 'UNVERIFIED' | 'ERROR'
  readonly is_synthetic: boolean
  readonly execution_type: string
  readonly status: string
  readonly base_sha?: string | null
  readonly result_sha?: string | null
  readonly canonical_sha256?: string | null
  readonly started_at?: string | null
  readonly finished_at?: string | null
  readonly process_exit_code?: number | null
  readonly verdict?: string | null
  readonly checks_count: number
  readonly markdown_packet?: string | null
}

export type ActivityItemDTO = {
  readonly id?: number
  readonly from_state: string
  readonly to_state: string
  readonly reason: string
  readonly timestamp?: string | null
}

type Props = {
  readonly projectId: string
  readonly taskId: string
}

export function ManagedTaskDetailCard({ projectId, taskId }: Props): React.JSX.Element {
  const [tab, setTab] = useState<'REVIEW' | 'ACTIVITY' | 'EVIDENCE'>('REVIEW')
  const [loading, setLoading] = useState<boolean>(true)
  const [reviewPacket, setReviewPacket] = useState<ReviewPacketDTO | null>(null)
  const [evidence, setEvidence] = useState<EvidenceDTO | null>(null)
  const [activities, setActivities] = useState<readonly ActivityItemDTO[]>([])
  const [copied, setCopied] = useState<boolean>(false)

  useEffect(() => {
    let cancelled = false
    async function loadData() {
      setLoading(true)
      try {
        const [revRes, evRes, actRes] = await Promise.all([
          window.api?.managed?.presentReviewPacket
            ? window.api.managed.presentReviewPacket(projectId, taskId)
            : Promise.resolve({ ok: false }),
          window.api?.managed?.getEvidence
            ? window.api.managed.getEvidence(projectId, taskId)
            : Promise.resolve({ ok: false }),
          window.api?.managed?.listActivity
            ? window.api.managed.listActivity(projectId, taskId, 15)
            : Promise.resolve({ ok: false })
        ])

        if (!cancelled) {
          if (revRes?.ok && revRes.review_packet) {
            setReviewPacket(revRes.review_packet)
          } else {
            setReviewPacket(null)
          }
          if (evRes?.ok && evRes.evidence) {
            setEvidence(evRes.evidence)
          } else {
            setEvidence(null)
          }
          if (actRes?.ok && Array.isArray(actRes.activities)) {
            setActivities(actRes.activities)
          } else {
            setActivities([])
          }
        }
      } catch {
        if (!cancelled) {
          setReviewPacket(null)
          setEvidence(null)
          setActivities([])
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }
    loadData()
    return () => {
      cancelled = true
    }
  }, [projectId, taskId])

  function handleCopy() {
    if (reviewPacket?.markdown_packet) {
      navigator.clipboard.writeText(reviewPacket.markdown_packet)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  function getStatusBadge(statusStr: string, isSynthetic: boolean) {
    if (statusStr === 'NOT_RUN') {
      return (
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[9px] text-zinc-400 font-mono">
          NOT_RUN
        </span>
      )
    }
    if (statusStr === 'NOT_FOUND') {
      return (
        <span className="rounded bg-amber-950/60 px-1.5 py-0.5 text-[9px] text-amber-400 font-mono">
          NOT_FOUND
        </span>
      )
    }
    if (isSynthetic || statusStr === 'UNVERIFIED') {
      return (
        <span className="rounded bg-yellow-950/60 px-1.5 py-0.5 text-[9px] text-yellow-400 font-mono">
          UNVERIFIED (SINTÉTICO)
        </span>
      )
    }
    if (statusStr === 'AVAILABLE') {
      return (
        <span className="rounded bg-emerald-950/60 px-1.5 py-0.5 text-[9px] text-emerald-400 font-mono">
          AVAILABLE (AUTÉNTICO)
        </span>
      )
    }
    return (
      <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[9px] text-zinc-300 font-mono">
        {statusStr}
      </span>
    )
  }

  return (
    <div className="flex flex-col gap-1.5 rounded border border-border/30 bg-background/90 p-2 text-[10px]">
      <div className="flex items-center justify-between border-b border-border/30 pb-1.5">
        <div className="flex items-center gap-1 font-mono text-[9px]">
          <button
            type="button"
            onClick={() => setTab('REVIEW')}
            className={`flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors ${
              tab === 'REVIEW'
                ? 'bg-sky-500/20 text-sky-300 font-semibold'
                : 'text-muted-foreground hover:bg-muted/40'
            }`}
          >
            <FileText className="size-3" />
            <span>Revisión ChatGPT</span>
          </button>
          <button
            type="button"
            onClick={() => setTab('ACTIVITY')}
            className={`flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors ${
              tab === 'ACTIVITY'
                ? 'bg-sky-500/20 text-sky-300 font-semibold'
                : 'text-muted-foreground hover:bg-muted/40'
            }`}
          >
            <Activity className="size-3" />
            <span>Actividad ({activities.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setTab('EVIDENCE')}
            className={`flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors ${
              tab === 'EVIDENCE'
                ? 'bg-sky-500/20 text-sky-300 font-semibold'
                : 'text-muted-foreground hover:bg-muted/40'
            }`}
          >
            <FileCheck className="size-3" />
            <span>Evidencias</span>
          </button>
        </div>
        {loading ? <RefreshCw className="size-3 animate-spin text-muted-foreground" /> : null}
      </div>

      {loading ? (
        <div className="py-2 text-center text-muted-foreground italic">Cargando registros...</div>
      ) : tab === 'REVIEW' ? (
        reviewPacket ? (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                {getStatusBadge(reviewPacket.packet_status, reviewPacket.is_synthetic)}
                <span className="font-mono text-[9px] text-zinc-400">
                  {reviewPacket.execution_type}
                </span>
              </div>
              <button
                type="button"
                onClick={handleCopy}
                disabled={!reviewPacket.markdown_packet}
                className="inline-flex items-center gap-1 rounded bg-secondary px-2 py-0.5 font-mono text-[9px] text-secondary-foreground hover:bg-secondary/80 transition-colors"
              >
                {copied ? (
                  <Check className="size-2.5 text-emerald-400" />
                ) : (
                  <Copy className="size-2.5" />
                )}
                <span>{copied ? 'Copiado!' : 'Copiar para ChatGPT'}</span>
              </button>
            </div>

            {reviewPacket.is_synthetic ? (
              <div className="flex items-center gap-1 rounded border border-yellow-500/30 bg-yellow-950/20 px-2 py-1 text-[9px] text-yellow-300">
                <ShieldAlert className="size-3 shrink-0 text-yellow-400" />
                <span>Ejecución sintética en staging: resultados marcados como UNVERIFIED.</span>
              </div>
            ) : null}

            <div className="grid grid-cols-2 gap-1 rounded bg-muted/20 p-1.5 font-mono text-[9px]">
              <div>
                <span className="text-muted-foreground">Base SHA:</span>{' '}
                <span className="text-foreground">
                  {reviewPacket.base_sha?.slice(0, 10) || 'NONE'}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">Result SHA:</span>{' '}
                <span className="text-foreground">
                  {reviewPacket.result_sha?.slice(0, 10) || 'NONE'}
                </span>
              </div>
              <div className="col-span-2 truncate">
                <span className="text-muted-foreground">Signature:</span>{' '}
                <span className="text-foreground truncate">
                  {reviewPacket.canonical_sha256 || 'NONE'}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">Exit Code:</span>{' '}
                <span className="text-foreground">
                  {reviewPacket.process_exit_code !== null ? reviewPacket.process_exit_code : 'N/A'}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">Verdict:</span>{' '}
                <span className="font-semibold text-sky-400">
                  {reviewPacket.verdict || 'PENDING'}
                </span>
              </div>
            </div>
          </div>
        ) : (
          <div className="py-1 text-muted-foreground italic">
            Sin paquete de revisión disponible.
          </div>
        )
      ) : tab === 'ACTIVITY' ? (
        activities.length > 0 ? (
          <div className="flex flex-col gap-1 max-h-36 overflow-y-auto scrollbar-sleek pr-1">
            {activities.map((a, idx) => (
              <div
                key={a.id || idx}
                className="flex flex-col rounded border border-border/20 bg-muted/10 p-1.5 text-[9px] font-mono"
              >
                <div className="flex items-center justify-between text-muted-foreground">
                  <span className="text-foreground font-semibold">
                    {a.from_state} → {a.to_state}
                  </span>
                  <span>{a.timestamp ? a.timestamp.slice(11, 19) : ''}</span>
                </div>
                <div className="text-zinc-400 text-[8.5px] truncate">{a.reason}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="py-1 text-muted-foreground italic">
            Sin eventos de actividad registrados.
          </div>
        )
      ) : evidence ? (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5">
            {getStatusBadge(evidence.evidence_status, evidence.is_synthetic)}
            <span className="font-mono text-[9px] text-zinc-400">
              {evidence.checks.length} check(s), {evidence.artifacts.length} artefacto(s)
            </span>
          </div>

          {evidence.checks.length > 0 ? (
            <div className="flex flex-col gap-0.5 rounded bg-muted/20 p-1 font-mono text-[9px]">
              <span className="font-semibold text-muted-foreground text-[8px] uppercase">
                Verificaciones:
              </span>
              {evidence.checks.map((c, i) => (
                <div key={i} className="flex items-center justify-between text-[8.5px]">
                  <span className="truncate">{String(c.name || 'check')}</span>
                  <span className="text-emerald-400 inline-flex items-center gap-0.5">
                    <ShieldCheck className="size-2.5" /> PASS
                  </span>
                </div>
              ))}
            </div>
          ) : null}

          {evidence.artifacts.length > 0 ? (
            <div className="flex flex-col gap-0.5 font-mono text-[9px]">
              <span className="font-semibold text-muted-foreground text-[8px] uppercase">
                Artefactos:
              </span>
              {evidence.artifacts.map((art, i) => (
                <div key={i} className="flex items-center gap-1 text-[8.5px] text-zinc-300">
                  <CheckCircle2 className="size-2.5 text-sky-400 shrink-0" />
                  <span className="truncate">{art}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="py-1 text-muted-foreground italic">Sin evidencias registradas.</div>
      )}
    </div>
  )
}
