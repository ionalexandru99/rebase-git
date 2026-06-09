import { cn } from '@/lib/utils'
import { Checkbox } from '../ui/checkbox'
import { StatusBadge, type StatusKind } from './StatusBadge'

interface FileRowProps {
  file: string
  display?: string
  kind: StatusKind
  isStaged: boolean
  isSelected: boolean
  onSelect: (file: string, staged: boolean) => void
  onStage?: (file: string) => void
  onUnstage?: (file: string) => void
}

export function FileRow(props: FileRowProps) {
  const label = () => props.display ?? props.file

  const toggleStaged = () => {
    if (props.isStaged) {
      props.onUnstage?.(props.file)
      return
    }
    props.onStage?.(props.file)
  }

  return (
    <div
      className={cn(
        'grid h-8 grid-cols-[15px_18px_minmax(0,1fr)] items-center gap-2 rounded-[var(--r-sm)] px-2 transition-colors',
        props.isSelected ? 'bg-[var(--brand-soft)]' : 'hover:bg-muted'
      )}
      data-testid="status-file-row"
    >
      <Checkbox
        checked={props.isStaged}
        aria-label={props.isStaged ? `Unstage ${label()}` : `Stage ${label()}`}
        onChange={() => toggleStaged()}
      />
      <StatusBadge kind={props.kind} />
      <button
        type="button"
        onClick={() => props.onSelect(props.file, props.isStaged)}
        className="flex h-full min-w-0 items-center text-left"
      >
        <span className="min-w-0 truncate text-sm" title={label()}>
          {label()}
        </span>
      </button>
    </div>
  )
}
