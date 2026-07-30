import { FileDiff, Virtualizer } from '@pierre/diffs/react'
import { FileDiffIcon } from 'lucide-react'
import { type ReactNode, useMemo } from 'react'
import { DIFF_UNSAFE_CSS, diffThemeStyle } from '@/features/diff/diff-theme'
import { parsePatch } from '@/features/diff/patch-parse'
import { type DiffStyle, useDiffStyle } from '@/features/diff/useDiffStyle'
import { useThemeNonce } from '@/hooks/useThemeNonce'
import { cn } from '@/lib/utils'
import { useCommitFileDiff } from '@/stores/git'
import { EmptyState } from '../../components/ui/empty-state'

export interface CommitDiffSelection {
  commit: string
  file: string
  renameSource?: string
  binary: boolean
}

interface CommitDiffViewProps {
  selected: CommitDiffSelection | null
}

export function CommitDiffView(props: CommitDiffViewProps) {
  const selected = props.selected
  const fetchableFile = selected && !selected.binary ? selected.file : null
  const diffQuery = useCommitFileDiff(
    selected?.commit ?? null,
    fetchableFile,
    selected?.renameSource
  )
  const [diffStyle, setDiffStyle] = useDiffStyle()
  useThemeNonce()
  const themeType: 'light' | 'dark' = document.documentElement.classList.contains('dark')
    ? 'dark'
    : 'light'

  const patch = diffQuery.data?.patch
  const parsed = useMemo(() => {
    if (!selected || patch === undefined) {
      return null
    }
    return parsePatch(patch, `${selected.commit}:${selected.file}`)
  }, [selected, patch])

  const options = useMemo(
    () => ({
      diffStyle,
      themeType,
      preferredHighlighter: 'shiki-js' as const,
      lineDiffType: 'word-alt' as const,
      maxLineDiffLength: 1000,
      diffIndicators: 'bars' as const,
      unsafeCSS: DIFF_UNSAFE_CSS,
      disableFileHeader: true
    }),
    [diffStyle, themeType]
  )

  const hunks = diffQuery.data?.diff.hunks ?? []
  const totals = useMemo(() => {
    let adds = 0
    let dels = 0
    for (const hunk of hunks) {
      for (const line of hunk.lines) {
        if (line.kind === 'add') {
          adds++
        } else if (line.kind === 'del') {
          dels++
        }
      }
    }
    return { adds, dels }
  }, [hunks])

  const parsedFiles = parsed?.kind === 'parsed' ? parsed.files : []
  const hasParsedContent = parsedFiles.some((file) => file.hunks.length > 0)

  return (
    <section className="grid h-full min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
      {selected ? (
        <div className="flex min-h-8 shrink-0 items-center gap-2.5 border-b py-1 pl-3.5 pr-2">
          <span className="min-w-0 truncate text-sm font-semibold" title={selected.file}>
            {selected.file}
          </span>
          {totals.adds > 0 || totals.dels > 0 ? (
            <span className="flex shrink-0 items-center gap-1.5 text-xs tabular-nums">
              <span className="text-add">+{totals.adds}</span>
              <span className="text-del">−{totals.dels}</span>
            </span>
          ) : null}
          <div className="flex-1" />
          <DiffStyleToggle diffStyle={diffStyle} onChange={setDiffStyle} />
        </div>
      ) : (
        <div className="border-b" />
      )}

      {!selected ? (
        <div className="min-h-0 overflow-auto p-2" data-testid="diff-body">
          <EmptyState
            size="sm"
            icon={FileDiffIcon}
            title="No file selected"
            description="Select a file on the left to review its changes."
          />
        </div>
      ) : diffQuery.isError ? (
        <StateNotice testId="diff-body" className="text-destructive">
          Failed to load diff
          {diffQuery.error instanceof Error ? `: ${diffQuery.error.message}` : '.'}
        </StateNotice>
      ) : selected.binary ? (
        <StateNotice testId="diff-body">Binary file — no preview available.</StateNotice>
      ) : diffQuery.isPending || parsed === null ? (
        <StateNotice testId="diff-body">Loading diff…</StateNotice>
      ) : parsed.kind === 'raw' ? (
        <div className="min-h-0 overflow-auto p-2" data-testid="diff-body">
          <pre
            className="whitespace-pre px-2 py-1 font-mono text-[13px] leading-[20px]"
            data-testid="diff-raw-patch"
          >
            {parsed.patch}
          </pre>
        </div>
      ) : !hasParsedContent ? (
        <StateNotice testId="diff-body">No changes to show.</StateNotice>
      ) : (
        <div className="min-h-0 overflow-hidden" data-testid="diff-body">
          <Virtualizer
            className="scroll-host h-full min-h-0 overflow-y-auto"
            style={diffThemeStyle()}
          >
            {parsedFiles.map((file) => (
              <FileDiff key={file.name} fileDiff={file} options={options} />
            ))}
          </Virtualizer>
        </div>
      )}
    </section>
  )
}

function StateNotice(props: { testId: string; className?: string; children: ReactNode }) {
  return (
    <div className="min-h-0 overflow-auto p-2" data-testid={props.testId}>
      <div className={cn('px-2 py-4 text-sm text-muted-foreground', props.className)}>
        {props.children}
      </div>
    </div>
  )
}

function DiffStyleToggle(props: { diffStyle: DiffStyle; onChange: (style: DiffStyle) => void }) {
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <DiffStyleButton
        label="Unified"
        active={props.diffStyle === 'unified'}
        onSelect={() => props.onChange('unified')}
      />
      <DiffStyleButton
        label="Split"
        active={props.diffStyle === 'split'}
        onSelect={() => props.onChange('split')}
      />
    </div>
  )
}

function DiffStyleButton(props: { label: string; active: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={props.active}
      onClick={props.onSelect}
      className={cn(
        'rounded-[var(--r-sm)] px-2 py-0.5 text-xs transition-colors',
        props.active
          ? 'bg-muted font-medium text-foreground'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground'
      )}
    >
      {props.label}
    </button>
  )
}
