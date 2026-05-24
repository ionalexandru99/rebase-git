import { Button } from '@/components/ui/button'
import { StatusBadge, type StatusKind } from './StatusBadge'

interface FileRowProps {
  file: string
  display?: string
  kind: StatusKind
  actionLabel?: string
  onAction?: (file: string) => void
}

export function FileRow({ file, display, kind, actionLabel, onAction }: FileRowProps) {
  const label = display ?? file
  return (
    <li className="group flex h-7 items-center gap-2 rounded-md px-2 hover:bg-accent">
      <StatusBadge kind={kind} />
      <span className="min-w-0 flex-1 truncate text-sm" title={label}>
        {label}
      </span>
      {actionLabel && onAction ? (
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
          onClick={() => onAction(file)}
        >
          {actionLabel}
        </Button>
      ) : null}
    </li>
  )
}
