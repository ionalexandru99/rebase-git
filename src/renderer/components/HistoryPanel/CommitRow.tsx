import { GitMerge } from 'lucide-react'
import { memo, useMemo } from 'react'
import { RemoteProviderIcon } from '@/components/RemoteProviderIcon'
import { Badge } from '@/components/ui/badge'
import { formatCommitDate, initials } from '@/lib/format'
import { laneColor, ROW_H } from '@/lib/git-graph/canvas'
import type { RowLayout } from '@/lib/git-graph/layout'
import { parseRefs, pillStyle, refClass, splitRemoteRef } from '@/lib/git-graph/refs'
import { cn } from '@/lib/utils'

interface CommitRowProps {
  row: RowLayout
  index: number
  dim: boolean
  offBranch: boolean
  rowRailWidth: number
  remotes: Record<string, string>
  remoteNames: Set<string>
}

export const CommitRow = memo(function CommitRow({
  row,
  index,
  dim,
  offBranch,
  rowRailWidth,
  remotes,
  remoteNames
}: CommitRowProps) {
  const commit = row.commit
  const isMerge = commit.parents.length >= 2
  const refs = useMemo(() => parseRefs(commit.refs, remoteNames), [commit.refs, remoteNames])
  const laneHex = laneColor(row.commitLane)
  const rowOpacity = dim ? 0.35 : offBranch ? 0.6 : 1
  const subjectClass = offBranch ? 'text-muted-foreground' : 'text-foreground'

  return (
    <div
      className="group/row absolute inset-x-0 z-10 grid items-center gap-1 bg-card px-0 hover:bg-muted"
      style={{
        top: 0,
        height: ROW_H,
        transform: `translateY(${index * ROW_H}px)`,
        gridTemplateColumns: 'var(--row-cols)',
        opacity: rowOpacity,
        contain: 'layout paint style'
      }}
    >
      <span
        className="flex min-w-0 items-center gap-1.5 overflow-hidden text-sm"
        style={{ paddingLeft: rowRailWidth }}
      >
        {isMerge && (
          <GitMerge aria-label="merge commit" className="size-3 shrink-0 text-emerald-500" />
        )}
        {refs.map((ref) => {
          const style = pillStyle(ref.kind, laneHex)
          const base = 'h-6 shrink-0 rounded-md border px-2.5 text-xs font-medium tracking-tight'
          if (ref.kind === 'remote') {
            const { remote, branch } = splitRemoteRef(ref.label)
            return (
              <Badge
                key={`${ref.kind}:${ref.label}`}
                variant="outline"
                className={cn(base, 'gap-1.5', refClass(ref.kind))}
                style={style}
                title={ref.label}
              >
                <RemoteProviderIcon url={remotes[remote]} className="!size-3.5" />
                {branch}
              </Badge>
            )
          }
          return (
            <Badge
              key={`${ref.kind}:${ref.label}`}
              variant="outline"
              className={cn(base, refClass(ref.kind))}
              style={style}
              title={ref.label}
            >
              {ref.label}
            </Badge>
          )
        })}
        <span className={cn('min-w-0 truncate', subjectClass)}>{commit.message}</span>
      </span>

      <span className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
        <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-secondary text-[10px] font-semibold text-foreground/80">
          {initials(commit.author_name)}
        </span>
        <span className="min-w-0 truncate">{commit.author_name}</span>
      </span>

      <code className="cursor-default truncate text-xs tabular-nums text-muted-foreground">
        {commit.hash.slice(0, 7)}
      </code>

      <time className="truncate pr-3 text-right text-xs tabular-nums text-muted-foreground">
        {formatCommitDate(commit.date)}
      </time>
    </div>
  )
})
