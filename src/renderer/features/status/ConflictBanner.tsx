import { AlertTriangleIcon } from 'lucide-react'
import { useWorkingTreeStatus } from '@/stores/git'

export function ConflictBanner() {
  const { status } = useWorkingTreeStatus()
  const conflictCount = status?.conflicted.length ?? 0

  if (conflictCount === 0) {
    return null
  }

  return (
    <div
      role="status"
      className="m-2 mb-0 flex shrink-0 items-start gap-2 rounded-[var(--r-sm)] border border-orange/40 bg-orange/10 px-3 py-2 text-sm"
    >
      <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-orange" />
      <div>
        <div className="font-semibold">
          {conflictCount} merge conflict{conflictCount === 1 ? '' : 's'}
        </div>
        <div className="text-xs text-muted-foreground">
          {conflictCount === 1
            ? 'Resolve the file, then stage it to continue.'
            : 'Resolve the files, then stage them to continue.'}
        </div>
      </div>
    </div>
  )
}
