import { Show } from '@/lib/react-compat'

interface StatusbarProps {
  branch: string
  changes: number
  directionLabel: string
  lastFetch?: string
}

export function Statusbar(props: StatusbarProps) {
  return (
    <div className="flex h-7 shrink-0 items-center gap-3 border-t bg-background px-3 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden="true" className="size-1.5 rounded-full bg-primary" />
        {props.branch}
      </span>
      <span>
        {props.changes} change{props.changes === 1 ? '' : 's'}
      </span>
      <span className="flex-1" />
      <span>
        Direction: <span className="text-foreground">{props.directionLabel}</span>
      </span>
      <span>·</span>
      <span>git</span>
      <Show when={props.lastFetch}>
        <span>·</span>
        <span>last fetch {props.lastFetch}</span>
      </Show>
    </div>
  )
}
