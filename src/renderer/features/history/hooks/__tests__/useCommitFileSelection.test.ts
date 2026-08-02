import type { CommitDetailFile } from '@shared/schemas/git'
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useCommitFileSelection } from '../useCommitFileSelection'

const file = (path: string, overrides: Partial<CommitDetailFile> = {}): CommitDetailFile => ({
  path,
  status: 'M',
  additions: 1,
  deletions: 0,
  binary: false,
  ...overrides
})

describe('useCommitFileSelection', () => {
  it('selects the first file in tree order', async () => {
    const files = [file('README.md'), file('src/beta.ts'), file('src/alpha.ts')]
    const { result } = renderHook(() => useCommitFileSelection('commit-a', files))

    await waitFor(() => expect(result.current.selectedPath).toBe('src/alpha.ts'))
    expect(result.current.selection).toEqual({
      commit: 'commit-a',
      file: 'src/alpha.ts',
      renameSource: undefined,
      binary: false
    })
  })

  it('maps the selected file metadata to the commit diff selection', async () => {
    const files = [
      file('src/current.ts', {
        status: 'R',
        oldPath: 'src/previous.ts',
        binary: true
      }),
      file('README.md')
    ]
    const { result } = renderHook(() => useCommitFileSelection('commit-b', files))

    await waitFor(() => expect(result.current.selectedPath).not.toBeNull())
    act(() => result.current.selectFile(files[0]))

    expect(result.current.selection).toEqual({
      commit: 'commit-b',
      file: 'src/current.ts',
      renameSource: 'src/previous.ts',
      binary: true
    })
  })

  it('preserves a selected path while it remains available', async () => {
    const initialFiles = [file('src/alpha.ts'), file('src/beta.ts')]
    const { result, rerender } = renderHook(
      ({ files }) => useCommitFileSelection('commit-c', files),
      { initialProps: { files: initialFiles } }
    )
    await waitFor(() => expect(result.current.selectedPath).toBe('src/alpha.ts'))
    act(() => result.current.selectFile(initialFiles[1]))

    rerender({ files: [file('src/beta.ts', { additions: 5 }), file('src/gamma.ts')] })

    await waitFor(() => expect(result.current.selectedPath).toBe('src/beta.ts'))
    expect(result.current.selection?.file).toBe('src/beta.ts')
  })

  it('falls back when the selected path disappears and clears for no files', async () => {
    const initialFiles = [file('src/alpha.ts'), file('src/beta.ts')]
    const { result, rerender } = renderHook(
      ({ files }) => useCommitFileSelection('commit-d', files),
      { initialProps: { files: initialFiles } }
    )
    await waitFor(() => expect(result.current.selectedPath).toBe('src/alpha.ts'))
    act(() => result.current.selectFile(initialFiles[1]))

    rerender({ files: [file('README.md'), file('src/gamma.ts')] })
    await waitFor(() => expect(result.current.selectedPath).toBe('src/gamma.ts'))

    rerender({ files: [] })
    await waitFor(() => expect(result.current.selectedPath).toBeNull())
    expect(result.current.selection).toBeNull()
  })

  it('updates the commit without losing the selected file', async () => {
    const files = [file('src/alpha.ts')]
    const { result, rerender } = renderHook(({ sha }) => useCommitFileSelection(sha, files), {
      initialProps: { sha: 'commit-e' }
    })
    await waitFor(() => expect(result.current.selectedPath).toBe('src/alpha.ts'))

    rerender({ sha: 'commit-f' })

    expect(result.current.selectedPath).toBe('src/alpha.ts')
    expect(result.current.selection?.commit).toBe('commit-f')
  })
})
