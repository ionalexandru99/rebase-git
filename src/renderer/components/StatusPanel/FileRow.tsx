import { Show } from '@/lib/react-compat'
import { Button } from '../ui/button'
import { StatusBadge, type StatusKind } from './StatusBadge'

interface FileRowProps {
  file: string
  display?: string
  kind: StatusKind
  actionLabel?: string
  onAction?: (file: string) => void
}

export function FileRow(props: FileRowProps) {
  const label = () => props.display ?? props.file
  return (
    <div className="group flex h-7 items-center gap-2 rounded-md px-2 hover:bg-accent">
      <StatusBadge kind={props.kind} />
      <span className="min-w-0 flex-1 truncate text-sm" title={label()}>
        {label()}
      </span>
      <Show when={props.actionLabel && props.onAction}>
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
          onClick={() => props.onAction?.(props.file)}
        >
          {props.actionLabel}
        </Button>
      </Show>
    </div>
  )
}
