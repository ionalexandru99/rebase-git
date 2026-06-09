import { GitMergeIcon } from 'lucide-react'
import { formatCommitDate, initials } from '@/lib/format'
import { computeRowRailWidth, laneColor, ROW_H } from '@/lib/git-graph/canvas'
import type { RowLayout } from '@/lib/git-graph/layout'
import { parseRefs } from '@/lib/git-graph/refs'
import { createMemo, For, Show } from '@/lib/react-compat'
import { cn } from '@/lib/utils'
import { RefBadge } from './RefBadge'

interface CommitRowProps {
  row: RowLayout
  top: number
  dim: boolean
  offBranch: boolean
  gridTail: string
  remotes: Record<string, string>
  remoteNames: Set<string>
}

export function CommitRow(props: CommitRowProps) {
  const commit = () => props.row.commit
  const isMerge = () => commit().parents.length >= 2
  const refs = createMemo(() => parseRefs(commit().refs, props.remoteNames))
  const laneHex = () => laneColor(props.row.commitLane)
  const rowOpacity = () => (props.dim ? 0.35 : props.offBranch ? 0.6 : 1)
  const subjectClass = () => (props.offBranch ? 'text-muted-foreground' : 'text-foreground')
  const gridTemplate = () => `${computeRowRailWidth(props.row)}px minmax(0,1fr) ${props.gridTail}`

  return (
    <div
      className="group/row absolute inset-x-0 z-10 grid items-center gap-2 border-b bg-card px-0 hover:bg-muted"
      style={{
        top: `${props.top}px`,
        height: `${ROW_H}px`,
        gridTemplateColumns: gridTemplate(),
        opacity: String(rowOpacity()),
        contain: 'layout style'
      }}
    >
      <span aria-hidden="true" />
      <span className="flex min-w-0 items-center gap-1 overflow-hidden text-sm">
        <Show when={isMerge()}>
          <GitMergeIcon aria-label="merge commit" className="size-3 shrink-0 text-green" />
        </Show>
        <For each={refs()}>
          {(parsedRef) => (
            <RefBadge parsedRef={parsedRef} laneHex={laneHex()} remotes={props.remotes} />
          )}
        </For>
        <span className={cn('min-w-0 truncate', subjectClass())}>{commit().message}</span>
      </span>

      <span className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
        <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-foreground/80">
          {initials(commit().author_name)}
        </span>
        <span className="min-w-0 truncate">{commit().author_name}</span>
      </span>

      <span className="cursor-default truncate text-xs tabular-nums text-muted-foreground">
        {commit().hash.slice(0, 7)}
      </span>

      <time className="truncate pr-3 text-right text-xs tabular-nums text-muted-foreground">
        {formatCommitDate(commit().date)}
      </time>
    </div>
  )
}
