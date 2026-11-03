import React from 'react'
import type { ActivityItemDTO } from './ManagedTaskDetailTypes'

type Props = {
  readonly activities: readonly ActivityItemDTO[]
}

export function ManagedActivityView({ activities }: Props): React.JSX.Element {
  if (activities.length === 0) {
    return (
      <div className="py-1 text-muted-foreground italic">Sin eventos de actividad registrados.</div>
    )
  }

  return (
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
  )
}
