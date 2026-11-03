import React, { useState, useEffect, useCallback } from 'react'
import { Activity, AlertOctagon, AlertTriangle, FileCheck, FileText, RefreshCw } from 'lucide-react'
import type { ActivityItemDTO, EvidenceDTO, ReviewPacketDTO } from './ManagedTaskDetailTypes'
import { ManagedReviewPacketView } from './ManagedReviewPacketView'
import { ManagedEvidenceView } from './ManagedEvidenceView'
import { ManagedActivityView } from './ManagedActivityView'

export * from './ManagedTaskDetailTypes'

type Props = {
  readonly projectId: string
  readonly taskId: string
  readonly onStateChanged?: () => void
}

export function ManagedTaskDetailCard({
  projectId,
  taskId,
  onStateChanged
}: Props): React.JSX.Element {
  const [tab, setTab] = useState<'REVIEW' | 'ACTIVITY' | 'EVIDENCE'>('REVIEW')
  const [loading, setLoading] = useState(true)
  const [reviewPacket, setReviewPacket] = useState<ReviewPacketDTO | null>(null)
  const [evidence, setEvidence] = useState<EvidenceDTO | null>(null)
  const [activities, setActivities] = useState<readonly ActivityItemDTO[]>([])
  const [offline, setOffline] = useState(false)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [revRes, evRes, actRes] = await Promise.all([
        window.api?.managed?.presentReviewPacket
          ? window.api.managed.presentReviewPacket(projectId, taskId)
          : Promise.resolve({ ok: false, status: 'OFFLINE' }),
        window.api?.managed?.getEvidence
          ? window.api.managed.getEvidence(projectId, taskId)
          : Promise.resolve({ ok: false, status: 'OFFLINE' }),
        window.api?.managed?.listActivity
          ? window.api.managed.listActivity(projectId, taskId, 15)
          : Promise.resolve({ ok: false, status: 'OFFLINE' })
      ])

      if (revRes?.status === 'OFFLINE' || evRes?.status === 'OFFLINE') {
        setOffline(true)
      } else {
        setOffline(false)
      }
      setReviewPacket(
        revRes?.ok && revRes.review_packet ? (revRes.review_packet as ReviewPacketDTO) : null
      )
      setEvidence(evRes?.ok && evRes.evidence ? (evRes.evidence as EvidenceDTO) : null)
      setActivities(actRes?.ok && Array.isArray(actRes.activities) ? actRes.activities : [])
    } catch {
      setOffline(true)
      setReviewPacket(null)
      setEvidence(null)
      setActivities([])
    } finally {
      setLoading(false)
    }
  }, [projectId, taskId])

  useEffect(() => {
    loadData()
  }, [loadData])

  function handleVerdictApplied() {
    loadData()
    if (onStateChanged) {
      onStateChanged()
    }
  }

  const hasFailedChecks =
    (evidence?.checks_summary && evidence.checks_summary.failed > 0) ||
    (reviewPacket?.checks_summary && reviewPacket.checks_summary.failed > 0) ||
    (evidence?.checks && evidence.checks.some((c) => c.status === 'FAIL'))

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

      {offline ? (
        <div className="flex items-center gap-1.5 rounded border border-rose-500/40 bg-rose-950/30 p-1.5 text-[9px] text-rose-300">
          <AlertOctagon className="size-3 text-rose-400 shrink-0" />
          <span>Motor desconectado o no accesible. Datos históricos purgados.</span>
        </div>
      ) : null}

      {hasFailedChecks ? (
        <div className="flex items-center gap-1.5 rounded border border-rose-500/40 bg-rose-950/30 p-1.5 text-[9px] text-rose-300">
          <AlertTriangle className="size-3 text-rose-400 shrink-0" />
          <span>Atención: Verificaciones fallidas registradas. Ejecución no certificada.</span>
        </div>
      ) : null}

      {loading ? (
        <div className="py-2 text-center text-muted-foreground italic">Cargando registros...</div>
      ) : tab === 'REVIEW' ? (
        <ManagedReviewPacketView
          projectId={projectId}
          taskId={taskId}
          reviewPacket={reviewPacket}
          onVerdictApplied={handleVerdictApplied}
        />
      ) : tab === 'ACTIVITY' ? (
        <ManagedActivityView activities={activities} />
      ) : (
        <ManagedEvidenceView evidence={evidence} />
      )}
    </div>
  )
}
