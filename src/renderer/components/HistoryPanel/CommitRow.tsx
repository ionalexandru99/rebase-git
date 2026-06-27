import { GitMergeIcon } from 'lucide-react'
import { memo, useMemo } from 'react'
import { formatCommitDate, initials } from '@/lib/format'
import type { CommitAction } from '@/lib/git-actions'
import { computeRowRailWidth, laneColor, ROW_H } from '@/lib/git-graph/canvas'
import type { RowLayout } from '@/lib/git-graph/layout'
import { parseRefs } from '@/lib/git-graph/refs'
import { cn } from '@/lib/utils'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTriggerArea
} from '../ui/context-menu'
import { RefBadge } from './RefBadge'

interface CommitRowProps {
  row: RowLayout
  top: number
  dim: boolean
  offBranch: boolean
  gridTail: string
  remotes: Record<string, string>
  remoteNames: Set<string>
  onCommitAction?: (action: CommitAction, sha: string, message: string) => void
}

// The graph rail is aria-hidden canvas, so the only topology a screen reader gets is this row hint.
export function commitTopologyLabel(parentCount: number, offBranch: boolean): string {
  const base =
    parentCount === 0
      ? 'Root commit'
      : parentCount >= 2
        ? `Merge commit with ${parentCount} parents`
        : 'Commit'
  return offBranch ? `${base}, off the current branch` : base
}

export const CommitRow = memo(function CommitRow(props: CommitRowProps) {
  const commit = props.row.commit
  const isMerge = commit.parents.length >= 2
  const refs = useMemo(
    () => parseRefs(commit.refs, props.remoteNames),
    [commit.refs, props.remoteNames]
  )
  const laneHex = laneColor(props.row.commitLane)
  const rowOpacity = props.dim ? 0.35 : props.offBranch ? 0.6 : 1
  const subjectClass = props.offBranch ? 'text-muted-foreground' : 'text-foreground'
  const gridTemplate = `${computeRowRailWidth(props.row)}px minmax(0,1fr) ${props.gridTail}`
  const act = (action: CommitAction) => props.onCommitAction?.(action, commit.hash, commit.message)

  return (
    <ContextMenu>
      <ContextMenuTriggerArea
        data-testid="commit-row"
        className="group/row absolute inset-x-0 z-10 grid items-center gap-2 border-b bg-card px-0 hover:bg-muted"
        style={{
          top: `${props.top}px`,
          height: `${ROW_H}px`,
          gridTemplateColumns: gridTemplate,
          opacity: String(rowOpacity),
          contain: 'layout style'
        }}
      >
        <span aria-hidden="true" />
        <span className="flex min-w-0 items-center gap-1 overflow-hidden text-sm">
          <span className="sr-only">
            {commitTopologyLabel(commit.parents.length, props.offBranch)}
          </span>
          {isMerge ? (
            <GitMergeIcon aria-hidden="true" className="size-3 shrink-0 text-green" />
          ) : null}
          {refs.map((parsedRef) => (
            <RefBadge
              key={`${parsedRef.kind}:${parsedRef.label}`}
              parsedRef={parsedRef}
              laneHex={laneHex}
              remotes={props.remotes}
            />
          ))}
          <span className={cn('min-w-0 truncate', subjectClass)}>{commit.message}</span>
        </span>

        <span className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
          <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-foreground/80">
            {initials(commit.author_name)}
          </span>
          <span className="min-w-0 truncate">{commit.author_name}</span>
        </span>

        <span className="cursor-default truncate text-xs tabular-nums text-muted-foreground">
          {commit.hash.slice(0, 7)}
        </span>

        <time className="truncate pr-3 text-right text-xs tabular-nums text-muted-foreground">
          {formatCommitDate(commit.date)}
        </time>
      </ContextMenuTriggerArea>
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => act('branch-here')}>Create branch here</ContextMenuItem>
        <ContextMenuItem onSelect={() => act('tag-here')}>Create tag here</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => act('cherry-pick')}>
          Cherry-pick onto current
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => act('revert')}>Revert commit</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => act('reset-soft')}>
          Reset branch here (soft)
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => act('reset-mixed')}>
          Reset branch here (mixed)
        </ContextMenuItem>
        <ContextMenuItem variant="destructive" onSelect={() => act('reset-hard')}>
          Reset branch here (hard)
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => act('copy-sha')}>Copy SHA</ContextMenuItem>
        <ContextMenuItem onSelect={() => act('copy-message')}>Copy message</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
})
