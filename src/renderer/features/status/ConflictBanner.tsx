import { AlertTriangleIcon } from 'lucide-react'
import {
  conflictBarGuidance,
  type OperationSummary,
  resolvedOperationGuidance,
  summarizeOperation
} from '@/features/status/operation-summary'
import { useWorkingTreeStatus } from '@/stores/git'

const BANNER_CLASS =
  'm-2 mb-0 flex shrink-0 items-center gap-2 rounded-[var(--r-sm)] border border-orange/40 bg-orange/10 px-3 py-1.5 text-sm'

const BUTTON_CLASS =
  'h-7 shrink-0 rounded-[var(--r-sm)] border bg-card px-2.5 text-xs font-medium transition-colors disabled:opacity-50'

interface ConflictBannerProps {
  busy?: boolean
  onContinue: (noun: string) => void
  onAbort: (summary: OperationSummary) => void
}

export function ConflictBanner(props: ConflictBannerProps) {
  const { status } = useWorkingTreeStatus()
  const conflicted = status?.conflicted ?? []
  const conflictCount = conflicted.length
  const operation = status?.operation
  const guidance = conflictCount > 0 ? conflictBarGuidance(conflictCount, conflicted[0]) : undefined

  if (!operation) {
    if (!guidance) {
      return null
    }
    return (
      <div role="status" data-testid="conflict-bar" className={BANNER_CLASS}>
        <AlertTriangleIcon className="size-4 shrink-0 text-orange" />
        <span className="min-w-0 flex-1 truncate" title={guidance}>
          {guidance}
        </span>
      </div>
    )
  }

  const summary = summarizeOperation(operation)
  const blocked = conflictCount > 0

  return (
    <div role="status" data-testid="conflict-bar" className={BANNER_CLASS}>
      <AlertTriangleIcon className="size-4 shrink-0 text-orange" />
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <span className="shrink-0 font-semibold">{summary.title}</span>
        {summary.progress ? (
          <span className="shrink-0 rounded-full bg-orange/20 px-1.5 py-0.5 text-[11px] tabular-nums">
            {summary.progress}
          </span>
        ) : null}
        <span
          className="min-w-0 truncate text-xs text-muted-foreground"
          title={guidance ?? resolvedOperationGuidance(summary)}
        >
          {guidance ?? resolvedOperationGuidance(summary)}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {summary.canContinue ? (
          <button
            type="button"
            onClick={() => props.onContinue(summary.noun)}
            disabled={blocked || props.busy}
            title={blocked ? 'Resolve and stage every conflicted file first.' : undefined}
            className={`${BUTTON_CLASS} hover:border-border-strong`}
          >
            {summary.continueText}
          </button>
        ) : (
          <span className="text-xs text-muted-foreground">
            Finish this merge from the commit box below.
          </span>
        )}
        <button
          type="button"
          onClick={() => props.onAbort(summary)}
          disabled={props.busy}
          className={`${BUTTON_CLASS} text-destructive hover:border-destructive/50`}
        >
          {summary.abortText}
        </button>
      </div>
    </div>
  )
}
