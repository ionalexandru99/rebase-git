import type { ParsedHunk } from '@shared/unified-diff'
import { type LucideIcon, MinusIcon, PlusIcon, Trash2Icon, Undo2Icon } from 'lucide-react'
import { type ReactNode, useCallback, useMemo, useState } from 'react'
import type { HeadDropState } from '@/features/commit/amend-drops'
import { type DiffSide, hunkAtLine } from '@/features/diff/hunk-at-line'
import { cn } from '@/lib/utils'

export interface AmendDropControls {
  dropState: HeadDropState
  isHunkDropped: (hunkHeader: string) => boolean
  onToggleFile: () => void
  onToggleHunk: (hunkHeader: string, allHeaders: string[]) => void
}

interface HoveredLine {
  lineNumber: number
  side: DiffSide
}

interface DiffGutterActionsInput {
  hunks: readonly ParsedHunk[]
  amendDrop?: AmendDropControls
  hunkActionsEnabled: boolean
  activeLineCount: number | null
  showsStagedSide: boolean
  runLineAction: () => void | Promise<void>
  requestHunkAction: (action: 'stage' | 'unstage' | 'discard', hunk: ParsedHunk) => void
}

export function useDiffGutterActions(input: DiffGutterActionsInput) {
  const {
    hunks,
    amendDrop,
    hunkActionsEnabled,
    activeLineCount,
    showsStagedSide,
    runLineAction,
    requestHunkAction
  } = input
  const [hoveredLine, setHoveredLine] = useState<HoveredLine | null>(null)
  const gutterEnabled = Boolean(hunkActionsEnabled || amendDrop)

  const toggleHunkDrop = useCallback(
    (hunk: ParsedHunk) => {
      amendDrop?.onToggleHunk(
        hunk.header,
        hunks.map((entry) => entry.header)
      )
    },
    [amendDrop, hunks]
  )

  const hoveredHunk = hoveredLine
    ? hunkAtLine(hunks, hoveredLine.side, hoveredLine.lineNumber)
    : null
  const hoveredDropped = hoveredHunk
    ? (amendDrop?.isHunkDropped(hoveredHunk.header) ?? false)
    : false

  const renderGutterUtility = useCallback(
    (getHoveredLine: () => HoveredLine | undefined): ReactNode => {
      const actOnHovered = (run: (hunk: ParsedHunk) => void) => () => {
        const hovered = getHoveredLine()
        if (!hovered) {
          return
        }
        const hunk = hunkAtLine(hunks, hovered.side, hovered.lineNumber)
        if (hunk) {
          run(hunk)
        }
      }
      if (amendDrop) {
        return (
          <GutterActionRow>
            <GutterActionButton
              label={hoveredDropped ? 'Keep hunk' : 'Drop hunk'}
              icon={hoveredDropped ? Undo2Icon : MinusIcon}
              onClick={actOnHovered(toggleHunkDrop)}
            />
          </GutterActionRow>
        )
      }
      if (!hunkActionsEnabled) {
        return null
      }
      if (activeLineCount !== null) {
        const noun = activeLineCount === 1 ? 'line' : 'lines'
        return (
          <GutterActionRow>
            <GutterActionButton
              label={
                showsStagedSide
                  ? `Unstage ${activeLineCount} selected ${noun}`
                  : `Stage ${activeLineCount} selected ${noun}`
              }
              icon={showsStagedSide ? MinusIcon : PlusIcon}
              onClick={() => void runLineAction()}
            />
          </GutterActionRow>
        )
      }
      return (
        <GutterActionRow>
          {showsStagedSide ? (
            <GutterActionButton
              label="Unstage hunk"
              icon={MinusIcon}
              onClick={actOnHovered((hunk) => requestHunkAction('unstage', hunk))}
            />
          ) : (
            <>
              <GutterActionButton
                label="Stage hunk"
                icon={PlusIcon}
                onClick={actOnHovered((hunk) => requestHunkAction('stage', hunk))}
              />
              <GutterActionButton
                label="Discard hunk"
                icon={Trash2Icon}
                destructive={true}
                onClick={actOnHovered((hunk) => requestHunkAction('discard', hunk))}
              />
            </>
          )}
        </GutterActionRow>
      )
    },
    [
      amendDrop,
      hoveredDropped,
      toggleHunkDrop,
      hunkActionsEnabled,
      activeLineCount,
      showsStagedSide,
      runLineAction,
      hunks,
      requestHunkAction
    ]
  )

  const onLineEnter = useCallback((event: { lineNumber: number; annotationSide: DiffSide }) => {
    setHoveredLine({ lineNumber: event.lineNumber, side: event.annotationSide })
  }, [])

  const hunkAnnotations = useMemo(
    () =>
      !gutterEnabled || hunks.length === 0
        ? undefined
        : hunks.map((hunk) => ({
            side: (hunk.newCount > 0 ? 'additions' : 'deletions') as DiffSide,
            lineNumber: hunk.newCount > 0 ? hunk.newStart : hunk.oldStart,
            metadata: { header: hunk.header }
          })),
    [gutterEnabled, hunks]
  )

  const renderAnnotation = useCallback(
    (annotation: { metadata: { header: string } }): ReactNode => {
      const hunkIndex = hunks.findIndex((entry) => entry.header === annotation.metadata.header)
      if (hunkIndex === -1) {
        return null
      }
      const hunk = hunks[hunkIndex]
      const position = `${hunkIndex + 1} of ${hunks.length}`
      if (amendDrop) {
        if (amendDrop.isHunkDropped(hunk.header)) {
          return (
            <div className="flex items-center gap-2 border-b border-t bg-card-2 px-2.5 py-1 text-xs text-muted-foreground">
              <span>Dropped from last commit</span>
              <GutterActionButton
                label={`Keep hunk ${position}`}
                icon={Undo2Icon}
                onClick={() => toggleHunkDrop(hunk)}
              />
            </div>
          )
        }
        return (
          <FocusRevealRow>
            <GutterActionButton
              label={`Drop hunk ${position}`}
              icon={MinusIcon}
              onClick={() => toggleHunkDrop(hunk)}
            />
          </FocusRevealRow>
        )
      }
      return (
        <FocusRevealRow>
          {showsStagedSide ? (
            <GutterActionButton
              label={`Unstage hunk ${position}`}
              icon={MinusIcon}
              onClick={() => requestHunkAction('unstage', hunk)}
            />
          ) : (
            <>
              <GutterActionButton
                label={`Stage hunk ${position}`}
                icon={PlusIcon}
                onClick={() => requestHunkAction('stage', hunk)}
              />
              <GutterActionButton
                label={`Discard hunk ${position}`}
                icon={Trash2Icon}
                destructive={true}
                onClick={() => requestHunkAction('discard', hunk)}
              />
            </>
          )}
        </FocusRevealRow>
      )
    },
    [hunks, amendDrop, toggleHunkDrop, showsStagedSide, requestHunkAction]
  )

  return { gutterEnabled, onLineEnter, renderGutterUtility, hunkAnnotations, renderAnnotation }
}

function FocusRevealRow(props: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-1 px-2.5 py-0.5 not-focus-within:sr-only">
      {props.children}
    </div>
  )
}

function GutterActionRow(props: { children: ReactNode }) {
  return (
    <div className="absolute left-1 top-1/2 flex -translate-y-1/2 items-center gap-1">
      {props.children}
    </div>
  )
}

function GutterActionButton(props: {
  label: string
  icon: LucideIcon
  destructive?: boolean
  onClick: () => void
}) {
  const Icon = props.icon
  return (
    <button
      type="button"
      aria-label={props.label}
      title={props.label}
      onClick={props.onClick}
      className={cn(
        'grid size-[22px] place-content-center rounded-[var(--r-sm)] border bg-card shadow-sm transition-colors',
        props.destructive
          ? 'text-destructive hover:bg-destructive hover:text-white'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground'
      )}
    >
      <Icon className="size-3.5" />
    </button>
  )
}
