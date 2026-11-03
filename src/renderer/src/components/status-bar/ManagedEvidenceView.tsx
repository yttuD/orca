import React from 'react'
import { AlertOctagon, CheckCircle2, MinusCircle, ShieldCheck, XCircle } from 'lucide-react'
import type { EvidenceDTO } from './ManagedTaskDetailTypes'

function renderCheckStatus(status: string): React.JSX.Element {
  const s = (status || 'NOT_RUN').toUpperCase()
  if (s === 'PASS') {
    return (
      <span className="text-emerald-400 inline-flex items-center gap-0.5 font-semibold">
        <ShieldCheck className="size-2.5" /> PASS
      </span>
    )
  }
  if (s === 'FAIL') {
    return (
      <span className="text-rose-400 inline-flex items-center gap-0.5 font-semibold">
        <XCircle className="size-2.5" /> FAIL
      </span>
    )
  }
  if (s === 'BLOCKED' || s === 'ERROR') {
    return (
      <span className="text-rose-400 inline-flex items-center gap-0.5 font-semibold">
        <AlertOctagon className="size-2.5" /> {s}
      </span>
    )
  }
  if (s === 'SKIPPED') {
    return (
      <span className="text-yellow-400 inline-flex items-center gap-0.5">
        <MinusCircle className="size-2.5" /> SKIPPED
      </span>
    )
  }
  return <span className="text-zinc-400 inline-flex items-center gap-0.5">{s}</span>
}

type Props = {
  readonly evidence: EvidenceDTO | null
}

export function ManagedEvidenceView({ evidence }: Props): React.JSX.Element {
  if (!evidence) {
    return <div className="py-1 text-muted-foreground italic">Sin evidencias registradas.</div>
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <span className="rounded bg-sky-950/60 px-1.5 py-0.5 text-[9px] text-sky-400 font-mono">
            {evidence.evidence_status}
          </span>
          <span className="rounded bg-emerald-950/60 px-1.5 py-0.5 text-[9px] text-emerald-400 font-mono">
            {evidence.provenance}
          </span>
        </div>
        <span className="font-mono text-[9px] text-zinc-400">
          {evidence.checks.length} check(s), {evidence.artifacts.length} artefacto(s)
        </span>
      </div>

      {evidence.checks.length > 0 ? (
        <div className="flex flex-col gap-0.5 rounded bg-muted/20 p-1 font-mono text-[9px]">
          <span className="font-semibold text-muted-foreground text-[8px] uppercase">
            Verificaciones (Fidelidad de Estados):
          </span>
          {evidence.checks.map((c, i) => (
            <div key={i} className="flex items-center justify-between text-[8.5px]">
              <span className="truncate">{c.name || 'unnamed_check'}</span>
              {renderCheckStatus(c.status)}
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
  )
}
