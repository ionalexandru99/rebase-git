import { AlertTriangleIcon } from 'lucide-react'
import {
  type OperationSummary,
  operationGuidance,
  summarizeOperation
} from '@/features/status/operation-summary'
import { useWorkingTreeStatus } from '@/stores/git'

const BANNER_CLASS =
  'm-2 mb-0 flex shrink-0 items-start gap-2 rounded-[var(--r-sm)] border border-orange/40 bg-orange/10 px-3 py-2 text-sm'

const BUTTON_CLASS =
  'h-7 shrink-0 rounded-[var(--r-sm)] border bg-card px-2.5 text-xs font-medium transition-colors disabled:opacity-50'

interface ConflictBannerProps {
  busy?: boolean
  onContinue: (noun: string) => void
  onAbort: (summary: OperationSummary) => void
}

export function ConflictBanner(props: ConflictBannerProps) {
  const { status } = useWorkingTreeStatus()
  const conflictCount = status?.conflicted.length ?? 0
  const operation = status?.operation

  if (!operation) {
    if (conflictCount === 0) {
      return null
    }
    return (
      <div role="status" className={BANNER_CLASS}>
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

  const summary = summarizeOperation(operation)
  const blocked = conflictCount > 0

  return (
    <div role="status" className={BANNER_CLASS}>
      <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-orange" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 font-semibold">
          <span className="truncate">{summary.title}</span>
          {summary.progress ? (
            <span className="shrink-0 rounded-full bg-orange/20 px-1.5 py-0.5 text-[11px] tabular-nums">
              {summary.progress}
            </span>
          ) : null}
        </div>
        <div className="text-xs text-muted-foreground">
          {operationGuidance(summary, conflictCount)}
        </div>
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
