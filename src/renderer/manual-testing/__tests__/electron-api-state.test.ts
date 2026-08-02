import { describe, expect, it } from 'vitest'
import {
  addRef,
  captureFiles,
  createManualGitState,
  deleteRef,
  findRefCommitIndex,
  moveHead,
  refsForCommit,
  removeFiles,
  renameRef,
  restoreFiles,
  stageFile,
  unstageFile
} from '../electron-api-state'

const workspacePath = '/workspace'
const repoPath = '/workspace/repo'

const createState = (options: Parameters<typeof createManualGitState>[0] = {}) =>
  createManualGitState(options, workspacePath, repoPath)

describe('manual Git state', () => {
  it('creates independent state with optional history and conflicts', () => {
    const first = createState({ historyCount: 8, conflicted: true })
    const second = createState()

    expect(first.commits).toHaveLength(8)
    expect(first.status.conflicted).toEqual(['src/conflict.ts'])
    expect(second.commits).toHaveLength(4)
    expect(second.status.conflicted).toEqual([])
  })

  it('stages and unstages tracked and untracked files', () => {
    const state = createState()

    stageFile(state, 'src/renderer/App.tsx')
    stageFile(state, 'notes/manual-test.md')

    expect(state.status.staged).toEqual([
      'src/main/index.ts',
      'src/renderer/App.tsx',
      'notes/manual-test.md'
    ])
    expect(state.status.files.find((file) => file.path === 'notes/manual-test.md')).toMatchObject({
      index: 'A',
      working_dir: ' '
    })

    unstageFile(state, 'notes/manual-test.md')
    expect(state.status.modified).not.toContain('notes/manual-test.md')
    expect(state.status.not_added).toContain('notes/manual-test.md')
    expect(state.status.files.find((file) => file.path === 'notes/manual-test.md')).toMatchObject({
      index: '?',
      working_dir: '?'
    })
  })

  it('captures, removes, and exactly restores file status', () => {
    const state = createState()
    const files = captureFiles(
      state,
      state.status.files.map((file) => file.path)
    )

    removeFiles(
      state,
      files.map((file) => file.code.path)
    )
    expect(state.status.files).toEqual([])

    restoreFiles(state, files)
    expect(state.status.modified).toEqual(['src/renderer/App.tsx'])
    expect(state.status.staged).toEqual(['src/main/index.ts'])
    expect(state.status.not_added).toEqual(['notes/manual-test.md'])
  })

  it('moves, adds, renames, and deletes commit decorations', () => {
    const state = createState()
    const featureIndex = findRefCommitIndex(state, 'feature/streaming')

    moveHead(state, 'feature/streaming')
    addRef(state, featureIndex, 'release/manual')
    renameRef(state, 'release/manual', 'release/v2')
    deleteRef(state, 'release/v2')

    expect(refsForCommit(state.commits[featureIndex])).toContain('HEAD -> feature/streaming')
    expect(state.commits.flatMap(refsForCommit)).not.toContain('HEAD -> main')
    expect(state.commits.flatMap(refsForCommit)).not.toContain('release/v2')
  })
})
