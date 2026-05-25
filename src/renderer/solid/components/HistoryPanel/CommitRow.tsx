import { GitMergeIcon } from 'lucide-solid'
import { createMemo, For, Show } from 'solid-js'
import { formatCommitDate, initials } from '@/lib/format'
import { laneColor, ROW_H } from '@/lib/git-graph/canvas'
import type { RowLayout } from '@/lib/git-graph/layout'
import { parseRefs } from '@/lib/git-graph/refs'
import { cn } from '@/lib/utils'
import { RefBadge } from './RefBadge'

interface CommitRowProps {
  row: RowLayout
  index: number
  dim: boolean
  offBranch: boolean
  rowRailWidth: number
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

  return (
    <div
      class="group/row absolute inset-x-0 z-10 grid items-center gap-1 bg-card px-0 hover:bg-muted"
      style={{
        top: '0',
        height: `${ROW_H}px`,
        transform: `translateY(${props.index * ROW_H}px)`,
        'grid-template-columns': 'var(--row-cols)',
        opacity: String(rowOpacity()),
        contain: 'layout paint style'
      }}
    >
      <span
        class="flex min-w-0 items-center gap-1.5 overflow-hidden text-sm"
        style={{ 'padding-left': `${props.rowRailWidth}px` }}
      >
        <Show when={isMerge()}>
          <GitMergeIcon aria-label="merge commit" class="size-3 shrink-0 text-emerald-500" />
        </Show>
        <For each={refs()}>
          {(ref) => <RefBadge ref={ref} laneHex={laneHex()} remotes={props.remotes} />}
        </For>
        <span class={cn('min-w-0 truncate', subjectClass())}>{commit().message}</span>
      </span>

      <span class="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
        <span class="flex size-4 shrink-0 items-center justify-center rounded-full bg-secondary text-[10px] font-semibold text-foreground/80">
          {initials(commit().author_name)}
        </span>
        <span class="min-w-0 truncate">{commit().author_name}</span>
      </span>

      <code class="cursor-default truncate text-xs tabular-nums text-muted-foreground">
        {commit().hash.slice(0, 7)}
      </code>

      <time class="truncate pr-3 text-right text-xs tabular-nums text-muted-foreground">
        {formatCommitDate(commit().date)}
      </time>
    </div>
  )
}
