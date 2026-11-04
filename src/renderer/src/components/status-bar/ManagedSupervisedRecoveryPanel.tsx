import React from 'react'
import { LockKeyhole, ShieldAlert } from 'lucide-react'
import {
  describeSupervisedRecoveryForRenderer,
  describeQaLifecycleForRenderer
} from './ManagedSupervisedRecoveryPresentation'

type Props = {
  /** Deliberately not an IPC/live motor source. Undefined until QA feed exists. */
  readonly packet?: unknown
  /** Existing guarded Electron main QA lifecycle, display-only (NOT a native attestation). */
  readonly qaLifecycle?: unknown
}

/**
 * ORCA-D02 Gate 9B-C4-C-A — non-interactive renderer view.
 * Nothing here can start, stop, authorize, terminate or unlock a motor.
 * Never pass a raw journal or native executable path from Electron main.
 */
export function ManagedSupervisedRecoveryPanel({ packet, qaLifecycle }: Props): React.JSX.Element {
  const view = describeSupervisedRecoveryForRenderer(packet)
  const lifecycle = describeQaLifecycleForRenderer(qaLifecycle)
  return (
    <section
      aria-label="Diagnóstico de recuperación supervisada"
      className="rounded border border-amber-500/25 bg-amber-500/5 p-2.5 text-[11px]"
      data-recovery-startup-allowed="false"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 font-semibold text-amber-300">
          <ShieldAlert aria-hidden="true" className="size-3.5 shrink-0" />
          <span>{view.heading} · QA</span>
        </div>
        <span className="inline-flex items-center gap-1 rounded border border-rose-400/30 bg-rose-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-rose-300">
          <LockKeyhole aria-hidden="true" className="size-3" />
          BLOQUEADO
        </span>
      </div>
      <dl className="mt-2 grid gap-1.5 text-[10px]">
        <div>
          <dt className="text-muted-foreground">Estado declarado del QA de Electron</dt>
          <dd className="text-foreground">{lifecycle.label}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Proceso actual</dt>
          <dd className="text-foreground">{view.current}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Propietario anterior</dt>
          <dd className="text-foreground">{view.previous}</dd>
        </div>
      </dl>
      <div className="mt-2 border-t border-border/30 pt-1.5 text-[10px]">
        <span className="font-medium text-amber-300">Evidencia pendiente</span>
        <ul className="mt-1 list-inside list-disc space-y-0.5 text-muted-foreground">
          {view.missing.map((item) => <li key={item}>{item}</li>)}
        </ul>
      </div>
      <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
        {view.footnote}
      </p>
      <span className="sr-only">
        Sin acciones de reinicio ni terminación. La revisión humana no supera un bloqueo técnico.
      </span>
    </section>
  )
}
