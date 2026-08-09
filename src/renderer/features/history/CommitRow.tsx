import { GitMergeIcon } from 'lucide-react'
import { memo, useMemo } from 'react'
import { laneX } from '@/features/history/graph/canvas'
import type { GraphMetrics } from '@/features/history/graph/metrics'
import { parseRefs } from '@/features/history/graph/refs'
import { formatCommitAge, initials } from '@/lib/format'
import type { CommitAction } from '@/lib/git-actions'
import { cn } from '@/lib/utils'
import type { GitLogEntry } from '@/types'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTriggerArea
} from '../../components/ui/context-menu'
import type { SelectionModifiers } from './commit-selection'
import type { CommitStat } from './hooks/useCommitStats'
import { type HistoryListMode, modeIsSingleLine, modeShowsAuthorName } from './list-modes'
import { RefBadge, refBadgeName } from './RefBadge'
import { assignRefBadgeColors } from './ref-colors'
import { singleLineGridTemplate } from './row-layout'
import type { MergeGlyph } from './selectors'

interface CommitRowProps {
  commit: GitLogEntry
  lane: number
  metrics: GraphMetrics
  mode: HistoryListMode
  railWidth: number
  stats?: CommitStat
  top: number
  dim: boolean
  offBranch: boolean
  remotes: Record<string, string>
  remoteNames: Set<string>
  mergeGlyph?: MergeGlyph
  selected: boolean
  onToggleExpand?: (mergeHash: string) => void
  onSelect?: (sha: string, modifiers: SelectionModifiers) => void
  onCommitAction?: (action: CommitAction, sha: string, message: string) => void
}

const MERGE_TOGGLE_HIT = 18

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
  const commit = props.commit
  const isMerge = commit.parents.length >= 2
  const refs = useMemo(
    () => parseRefs(commit.refs, props.remoteNames),
    [commit.refs, props.remoteNames]
  )
  const badgeColors = useMemo(() => assignRefBadgeColors(refs.map(refBadgeName)), [refs])
  const rowOpacity = props.dim ? 0.35 : props.offBranch ? 0.6 : 1
  const subjectClass = props.offBranch ? 'text-muted-foreground' : 'text-foreground'
  const gridTemplate = singleLineGridTemplate(props.mode)
  const glyph = props.mergeGlyph
  const expandable = glyph === 'collapsed' || glyph === 'expanded'
  const act = (action: CommitAction) => props.onCommitAction?.(action, commit.hash, commit.message)
  const rowSurface = props.selected ? 'bg-[var(--brand-soft)]' : 'bg-card group-hover/row:bg-muted'

  const subject = (
    <span className="flex min-w-0 items-center gap-1 overflow-hidden text-sm">
      {isMerge ? <GitMergeIcon aria-hidden="true" className="size-3 shrink-0 text-green" /> : null}
      {refs.map((parsedRef, refIndex) => (
        <RefBadge
          key={`${parsedRef.kind}:${parsedRef.label}`}
          parsedRef={parsedRef}
          badgeHex={badgeColors[refIndex]}
          remotes={props.remotes}
        />
      ))}
      <span className={cn('min-w-0 truncate', subjectClass)}>{commit.message}</span>
    </span>
  )
  const avatar = (
    <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-foreground/80">
      {initials(commit.author_name)}
    </span>
  )
  const shortSha = (
    <span className="truncate text-right text-xs tabular-nums text-muted-foreground">
      {commit.hash.slice(0, 7)}
    </span>
  )
  const churn = (
    <span
      data-testid="commit-row-churn"
      className="flex shrink-0 items-center justify-end gap-1 text-xs tabular-nums"
    >
      {props.stats ? (
        <>
          <span className="text-add">{`+${props.stats.additions}`}</span>
          <span className="text-del">{`−${props.stats.deletions}`}</span>
        </>
      ) : null}
    </span>
  )
  const age = (
    <time className="truncate text-right text-xs tabular-nums text-muted-foreground">
      {formatCommitAge(commit.date, Date.now())}
    </time>
  )

  return (
    <ContextMenu>
      <ContextMenuTriggerArea
        data-testid="commit-row"
        data-selected={props.selected ? 'true' : undefined}
        onClick={(event) =>
          props.onSelect?.(commit.hash, {
            toggle: event.metaKey || event.ctrlKey,
            range: event.shiftKey
          })
        }
        className="group/row absolute inset-x-0 z-10 select-none border-b"
        style={{
          top: `${props.top}px`,
          height: `${props.metrics.rowHeight}px`,
          opacity: String(rowOpacity),
          contain: 'layout style'
        }}
      >
        {expandable ? (
          <button
            type="button"
            aria-expanded={glyph === 'expanded'}
            aria-label={
              glyph === 'expanded' ? 'Collapse merge side branch' : 'Expand merge side branch'
            }
            onClick={(event) => {
              event.stopPropagation()
              props.onToggleExpand?.(commit.hash)
            }}
            className="absolute z-20 -translate-y-1/2 rounded-full bg-transparent"
            style={{
              left: `${laneX(props.lane, props.metrics) - MERGE_TOGGLE_HIT / 2}px`,
              top: '50%',
              width: `${MERGE_TOGGLE_HIT}px`,
              height: `${MERGE_TOGGLE_HIT}px`
            }}
          />
        ) : null}

        <span className="sr-only">
          {commitTopologyLabel(commit.parents.length, props.offBranch)}
          {props.selected ? ', selected' : ''}
        </span>

        {props.mode === 'index' ? null : modeIsSingleLine(props.mode) ? (
          <div
            data-testid="commit-row-content"
            className={cn(
              'absolute inset-y-0 right-0 grid items-center gap-2 overflow-hidden pr-3',
              rowSurface
            )}
            style={{ left: `${props.railWidth}px`, gridTemplateColumns: gridTemplate }}
          >
            {subject}

            <span
              data-testid="commit-row-pinned-meta"
              className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground"
            >
              {avatar}
              {modeShowsAuthorName(props.mode) ? (
                <span className="min-w-0 truncate">{commit.author_name}</span>
              ) : null}
            </span>

            {shortSha}
            {age}
            {churn}
          </div>
        ) : (
          <div
            data-testid="commit-row-content"
            className={cn(
              'absolute inset-y-0 right-0 flex flex-col justify-center gap-0.5 overflow-hidden pr-3',
              rowSurface
            )}
            style={{ left: `${props.railWidth}px` }}
          >
            {subject}
            <span
              data-testid="commit-row-meta"
              className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground"
            >
              {avatar}
              <span className="min-w-0 truncate">{commit.author_name}</span>
              {shortSha}
              {age}
              {churn}
            </span>
          </div>
        )}
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
