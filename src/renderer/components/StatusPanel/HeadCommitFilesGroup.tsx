import type { HeadCommitFile } from '@shared/schemas/git'
import { cn } from '@/lib/utils'
import { StatusBadge, type StatusKind } from './StatusBadge'

interface HeadCommitFilesGroupProps {
  files: HeadCommitFile[]
  parentCount: number
  selectedFile: string | null
  onSelect: (file: string) => void
}

function badgeKind(status: string): StatusKind {
  switch (status[0]) {
    case 'A':
      return 'created'
    case 'D':
      return 'deleted'
    case 'R':
      return 'renamed'
    default:
      return 'modified'
  }
}

export function HeadCommitFilesGroup(props: HeadCommitFilesGroupProps) {
  // A merge commit stays reword-only — its files are the union of two parents and not safely
  // inspectable as a single range, so the group is suppressed.
  if (props.parentCount > 1) {
    return null
  }

  return (
    <section aria-label="From last commit" className="border-t px-2 py-1.5">
      <div className="px-2 pb-1 text-xs font-semibold text-muted-foreground">From last commit</div>
      <ul>
        {props.files.map((file) => (
          <li key={file.path} className="list-none">
            <button
              type="button"
              onClick={() => props.onSelect(file.path)}
              aria-current={props.selectedFile === file.path}
              className={cn(
                'grid h-8 w-full grid-cols-[18px_minmax(0,1fr)] items-center gap-2 rounded-[var(--r-sm)] px-2 text-left transition-colors',
                props.selectedFile === file.path ? 'bg-[var(--brand-soft)]' : 'hover:bg-muted'
              )}
            >
              <StatusBadge kind={badgeKind(file.status)} />
              <span className="min-w-0 truncate text-sm" title={file.path}>
                {file.path}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
