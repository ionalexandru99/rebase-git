import type { OperationState } from '@shared/schemas/git'
import { CheckIcon } from 'lucide-react'
import { summarizeOperation } from '@/features/status/operation-summary'

export function CleanWorkingTree(props: { operation?: OperationState }) {
  const summary = props.operation ? summarizeOperation(props.operation) : null

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2.5 text-center text-muted-foreground">
      <span className="flex size-[52px] items-center justify-center rounded-full bg-green/15 text-green">
        <CheckIcon className="size-6" strokeWidth={2.4} />
      </span>
      <div className="text-[15px] font-semibold text-foreground">
        {summary ? 'No changes left to resolve' : 'Working tree clean'}
      </div>
      <div className="text-sm">
        {summary
          ? `The working tree matches HEAD, but the ${summary.noun} is still in progress — finish or abort it above.`
          : 'Nothing to commit — every change is on a branch.'}
      </div>
    </div>
  )
}
