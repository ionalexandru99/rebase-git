import type { HeadCommitFile } from '@shared/schemas/git'
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { UnifiedFileRow } from '@/features/status/status-file-rows'
import { useLocalChangesSelection } from '@/features/status/useLocalChangesSelection'

const worktreeRow = (
  file: string,
  stageState: UnifiedFileRow['stageState'] = 'unstaged'
): UnifiedFileRow => ({
  file,
  fileKind: 'modified',
  stageState,
  isConflicted: false,
  isUntracked: false,
  source: 'worktree'
})

const headFile = (path: string, renameSource?: string): HeadCommitFile => ({
  status: renameSource ? 'R' : 'M',
  path,
  renameSource
})

const input = (
  rows: readonly UnifiedFileRow[],
  overrides: Partial<Parameters<typeof useLocalChangesSelection>[0]> = {}
) => ({
  rows,
  headFiles: [],
  headParentCount: 1,
  headSha: 'a'.repeat(40),
  amendActive: false,
  ...overrides
})

describe('useLocalChangesSelection', () => {
  it('selects the first visible status row using group order', () => {
    const { result } = renderHook(() =>
      useLocalChangesSelection(
        input([worktreeRow('unstaged.ts'), worktreeRow('staged.ts', 'staged')])
      )
    )

    expect(result.current.selected).toEqual({ file: 'staged.ts', group: 'staged' })
  })

  it('follows a file when staging moves it to another group', () => {
    const { result, rerender } = renderHook(({ rows }) => useLocalChangesSelection(input(rows)), {
      initialProps: { rows: [worktreeRow('changed.ts')] }
    })

    rerender({ rows: [worktreeRow('changed.ts', 'staged')] })

    expect(result.current.selected).toEqual({ file: 'changed.ts', group: 'staged' })
  })

  it('builds the commit range when selecting a HEAD file', () => {
    const { result } = renderHook(() =>
      useLocalChangesSelection(
        input([worktreeRow('working.ts')], {
          amendActive: true,
          headFiles: [headFile('renamed.ts', 'original.ts')]
        })
      )
    )

    act(() => result.current.selectFile('renamed.ts', 'head-commit', 'original.ts'))

    expect(result.current.selected).toEqual({
      file: 'renamed.ts',
      renameSource: 'original.ts',
      source: 'head-commit',
      range: 'HEAD~1..HEAD'
    })
  })

  it('tracks whole-file and hunk drops for the selected HEAD file', () => {
    const { result } = renderHook(() =>
      useLocalChangesSelection(
        input([], { amendActive: true, headFiles: [headFile('changed.ts')] })
      )
    )
    act(() => result.current.selectFile('changed.ts', 'head-commit'))

    act(() => result.current.amendDrop?.onToggleHunk('@@ first', ['@@ first', '@@ second']))
    expect(result.current.amendDrop?.dropState).toBe('partial')
    expect(result.current.amendDrop?.isHunkDropped('@@ first')).toBe(true)
    expect(result.current.droppedHeadHunks).toEqual([{ file: 'changed.ts', hunks: ['@@ first'] }])

    act(() => result.current.amendDrop?.onToggleFile())
    expect(result.current.amendDrop?.dropState).toBe('kept')
    expect(result.current.droppedHeadPaths).toEqual([])
  })

  it('resets drops and returns a HEAD selection to the working tree', () => {
    const { result } = renderHook(() =>
      useLocalChangesSelection(
        input([worktreeRow('working.ts')], {
          amendActive: true,
          headFiles: [headFile('renamed.ts', 'original.ts')]
        })
      )
    )
    act(() => result.current.selectFile('renamed.ts', 'head-commit', 'original.ts'))
    act(() => result.current.toggleHeadFileDrop('renamed.ts'))
    expect(result.current.droppedHeadPaths).toEqual(['original.ts', 'renamed.ts'])

    act(() => result.current.resetAmend())

    expect(result.current.selected).toEqual({ file: 'working.ts', group: 'unstaged' })
    expect(result.current.droppedHeadPaths).toEqual([])
  })

  it('does not expose merge commit files as amend rows', () => {
    const { result } = renderHook(() =>
      useLocalChangesSelection(
        input([], { amendActive: true, headFiles: [headFile('merge.ts')], headParentCount: 2 })
      )
    )

    expect(result.current.amendRows).toEqual([])
  })
})
