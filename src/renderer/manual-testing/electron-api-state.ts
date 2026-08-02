import type { GitLogEntry, GitStatus, StatusFileCode } from '@shared/schemas/git'
import { GIT_LOG_REF_SEPARATOR } from '@shared/schemas/git'

export interface ManualGitStateOptions {
  onboardingComplete?: boolean
  historyCount?: number
  conflicted?: boolean
}

type MutableGitStatus = {
  -readonly [Key in keyof GitStatus]: GitStatus[Key]
}

export interface ManualGitState {
  activeWorkspace: string | null
  branches: string[]
  commits: GitLogEntry[]
  onboardingComplete: boolean
  listPaneWidths: Record<string, number>
  nextObjectId: number
  persistedTabs: { tabs: Array<string | null>; activeIndex: number }
  pullDivergedStrategy: 'rebase' | 'merge' | null
  recentRepos: string[]
  refTreeToggles: string[]
  sidebarPrefs: { open: boolean; width: number }
  stashes: ManualStash[]
  status: MutableGitStatus
  tags: string[]
  workspaces: string[]
}

interface ManualStash {
  index: number
  ref: string
  oid: string
  message: string
  branch: string
  files: StashedFile[]
}

interface StashedFile {
  code: StatusFileCode
  conflicted: boolean
  created: boolean
  deleted: boolean
  modified: boolean
  notAdded: boolean
  staged: boolean
}

const initialCommits: GitLogEntry[] = [
  {
    hash: 'f4bb8c61594786428b298f640c44a2608c0e3f41',
    message: 'Make Rebase testable from Chromium',
    author_name: 'Alex Ionescu',
    date: '2026-07-21T09:42:00.000Z',
    parents: ['7b3ac7f6ea3c5eb71ca4bb4dd9c42f81acac42d0'],
    refs: `HEAD -> main${GIT_LOG_REF_SEPARATOR}origin/main`
  },
  {
    hash: '7b3ac7f6ea3c5eb71ca4bb4dd9c42f81acac42d0',
    message: 'Stream commit history over IPC',
    author_name: 'Mina Park',
    date: '2026-07-20T16:15:00.000Z',
    parents: ['26d2349a8d4d978a23c8baba564e0119eb21004c'],
    refs: `feature/streaming${GIT_LOG_REF_SEPARATOR}tag: v1.0.0`
  },
  {
    hash: '26d2349a8d4d978a23c8baba564e0119eb21004c',
    message: 'Move Git operations into the sidecar',
    author_name: 'Sam Rivera',
    date: '2026-07-19T11:08:00.000Z',
    parents: ['dc0e91cb8388adc22d255e2f65bdfab718586f9d'],
    refs: 'origin/feature/streaming'
  },
  {
    hash: 'dc0e91cb8388adc22d255e2f65bdfab718586f9d',
    message: 'Add repository tabs',
    author_name: 'Alex Ionescu',
    date: '2026-07-18T14:31:00.000Z',
    parents: [],
    refs: ''
  }
]

const initialStatus: GitStatus = {
  current: 'main',
  modified: ['src/renderer/App.tsx'],
  staged: ['src/main/index.ts'],
  not_added: ['notes/manual-test.md'],
  conflicted: [],
  deleted: [],
  created: [],
  renamed: [],
  files: [
    { path: 'src/renderer/App.tsx', index: ' ', working_dir: 'M' },
    { path: 'src/main/index.ts', index: 'M', working_dir: ' ' },
    { path: 'notes/manual-test.md', index: '?', working_dir: '?' }
  ]
}

function createManualCommits(historyCount: number): GitLogEntry[] {
  const commits = initialCommits.map((commit) => ({ ...commit, parents: [...commit.parents] }))
  const count = Math.max(commits.length, historyCount)
  if (count === commits.length) {
    return commits
  }
  const hashAt = (index: number) => index.toString(16).padStart(7, '0').padEnd(40, '0')
  commits[commits.length - 1].parents = [hashAt(commits.length)]
  for (let index = commits.length; index < count; index++) {
    commits.push({
      hash: hashAt(index),
      message: `Manual history commit ${index + 1}`,
      author_name: 'Pagination Fixture',
      date: new Date(Date.UTC(2026, 6, 18) - index * 60_000).toISOString(),
      parents: index + 1 < count ? [hashAt(index + 1)] : [],
      refs: ''
    })
  }
  return commits
}

export function cloneManualStatus(status: GitStatus): MutableGitStatus {
  return {
    ...status,
    modified: [...status.modified],
    staged: [...status.staged],
    not_added: [...status.not_added],
    conflicted: [...status.conflicted],
    deleted: [...status.deleted],
    created: [...status.created],
    renamed: status.renamed.map((entry) => ({ ...entry })),
    files: status.files.map((entry) => ({ ...entry }))
  }
}

export function createManualGitState(
  options: ManualGitStateOptions,
  workspacePath: string,
  repoPath: string
): ManualGitState {
  const onboardingComplete = options.onboardingComplete ?? true
  const status = cloneManualStatus(initialStatus)
  if (options.conflicted) {
    status.conflicted.push('src/conflict.ts')
    status.files.push({ path: 'src/conflict.ts', index: 'U', working_dir: 'U' })
  }
  return {
    activeWorkspace: onboardingComplete ? workspacePath : null,
    branches: ['main', 'feature/streaming', 'fix/window-state'],
    commits: createManualCommits(options.historyCount ?? initialCommits.length),
    onboardingComplete,
    listPaneWidths: {},
    nextObjectId: 1,
    persistedTabs: { tabs: [null], activeIndex: 0 },
    pullDivergedStrategy: null,
    recentRepos: [repoPath],
    refTreeToggles: [],
    sidebarPrefs: { open: true, width: 244 },
    stashes: [
      {
        index: 0,
        ref: 'stash@{0}',
        oid: '1c7a31006f3b79198ec715f83f7b81897fc4fbbc',
        message: 'WIP on main: polish command palette',
        branch: 'main',
        files: [
          {
            code: { path: 'src/renderer/App.tsx', index: ' ', working_dir: 'M' },
            conflicted: false,
            created: false,
            deleted: false,
            modified: true,
            notAdded: false,
            staged: false
          }
        ]
      }
    ],
    status,
    tags: ['v1.0.0'],
    workspaces: onboardingComplete ? [workspacePath] : []
  }
}

export function without(values: string[], value: string): string[] {
  return values.filter((candidate) => candidate !== value)
}

export function withValue(values: string[], value: string): string[] {
  return values.includes(value) ? values : [...values, value]
}

export function bodyString(body: Record<string, unknown>, key: string): string {
  const value = body[key]
  return typeof value === 'string' ? value : ''
}

export function bodyStrings(body: Record<string, unknown>, key: string): string[] {
  const value = body[key]
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : []
}

export function stageFile(state: ManualGitState, file: string): void {
  state.status.staged = withValue(state.status.staged, file)
  state.status.modified = without(state.status.modified, file)
  state.status.not_added = without(state.status.not_added, file)
  state.status.created = without(state.status.created, file)
  state.status.deleted = without(state.status.deleted, file)
  state.status.files = state.status.files.map((entry) => {
    if (entry.path !== file) {
      return entry
    }
    if (entry.index === '?' || entry.working_dir === '?') {
      return { ...entry, index: 'A', working_dir: ' ' }
    }
    return {
      ...entry,
      index: entry.working_dir !== ' ' ? entry.working_dir : entry.index,
      working_dir: ' '
    }
  })
}

export function unstageFile(state: ManualGitState, file: string): void {
  const wasAdded = state.status.files.some((entry) => entry.path === file && entry.index === 'A')
  state.status.staged = without(state.status.staged, file)
  state.status.modified = wasAdded
    ? without(state.status.modified, file)
    : withValue(state.status.modified, file)
  state.status.not_added = wasAdded
    ? withValue(state.status.not_added, file)
    : without(state.status.not_added, file)
  state.status.files = state.status.files.map((entry) => {
    if (entry.path !== file) {
      return entry
    }
    if (entry.index === 'A') {
      return { ...entry, index: '?', working_dir: '?' }
    }
    return { ...entry, index: ' ', working_dir: entry.index === ' ' ? 'M' : entry.index }
  })
}

export function removeFiles(state: ManualGitState, files: string[]): void {
  const removed = new Set(files)
  state.status.modified = state.status.modified.filter((file) => !removed.has(file))
  state.status.staged = state.status.staged.filter((file) => !removed.has(file))
  state.status.not_added = state.status.not_added.filter((file) => !removed.has(file))
  state.status.conflicted = state.status.conflicted.filter((file) => !removed.has(file))
  state.status.deleted = state.status.deleted.filter((file) => !removed.has(file))
  state.status.created = state.status.created.filter((file) => !removed.has(file))
  state.status.files = state.status.files.filter((file) => !removed.has(file.path))
}

export function captureFiles(state: ManualGitState, files: string[]): StashedFile[] {
  return files.map((path) => ({
    code: {
      ...(state.status.files.find((entry) => entry.path === path) ?? {
        path,
        index: ' ',
        working_dir: 'M'
      })
    },
    conflicted: state.status.conflicted.includes(path),
    created: state.status.created.includes(path),
    deleted: state.status.deleted.includes(path),
    modified: state.status.modified.includes(path),
    notAdded: state.status.not_added.includes(path),
    staged: state.status.staged.includes(path)
  }))
}

export function restoreFiles(state: ManualGitState, files: StashedFile[]): void {
  for (const file of files) {
    if (file.modified) {
      state.status.modified = withValue(state.status.modified, file.code.path)
    }
    if (file.staged) {
      state.status.staged = withValue(state.status.staged, file.code.path)
    }
    if (file.notAdded) {
      state.status.not_added = withValue(state.status.not_added, file.code.path)
    }
    if (file.conflicted) {
      state.status.conflicted = withValue(state.status.conflicted, file.code.path)
    }
    if (file.deleted) {
      state.status.deleted = withValue(state.status.deleted, file.code.path)
    }
    if (file.created) {
      state.status.created = withValue(state.status.created, file.code.path)
    }
    if (!state.status.files.some((entry) => entry.path === file.code.path)) {
      state.status.files = [...state.status.files, { ...file.code }]
    }
  }
}

export function reindexStashes(stashes: ManualStash[]): ManualStash[] {
  return stashes.map((stash, index) => ({ ...stash, index, ref: `stash@{${index}}` }))
}

export function refsForCommit(commit: GitLogEntry): string[] {
  return commit.refs ? commit.refs.split(GIT_LOG_REF_SEPARATOR) : []
}

export function findRefCommitIndex(state: ManualGitState, ref: string | undefined): number {
  if (!ref) {
    const headIndex = state.commits.findIndex((commit) =>
      refsForCommit(commit).some((candidate) => candidate.startsWith('HEAD -> '))
    )
    return headIndex === -1 ? 0 : headIndex
  }
  const index = state.commits.findIndex(
    (commit) =>
      commit.hash === ref ||
      refsForCommit(commit).some(
        (candidate) =>
          candidate === ref || candidate === `HEAD -> ${ref}` || candidate === `tag: ${ref}`
      )
  )
  return index === -1 ? 0 : index
}

export function updateCommitRefs(commit: GitLogEntry, refs: string[]): GitLogEntry {
  return { ...commit, refs: refs.join(GIT_LOG_REF_SEPARATOR) }
}

export function moveHead(state: ManualGitState, branch: string): void {
  const targetIndex = state.commits.findIndex((commit) =>
    refsForCommit(commit).some((ref) => ref === branch || ref === `HEAD -> ${branch}`)
  )
  const resolvedTargetIndex = targetIndex === -1 ? 0 : targetIndex
  state.commits = state.commits.map((commit, index) => {
    const refs = refsForCommit(commit).filter((ref) => !ref.startsWith('HEAD -> '))
    if (index === resolvedTargetIndex) {
      return updateCommitRefs(commit, [`HEAD -> ${branch}`, ...without(refs, branch)])
    }
    return updateCommitRefs(commit, refs)
  })
}

export function addRef(state: ManualGitState, commitIndex: number, ref: string): void {
  state.commits[commitIndex] = updateCommitRefs(
    state.commits[commitIndex],
    withValue(refsForCommit(state.commits[commitIndex]), ref)
  )
}

export function nextObjectId(state: ManualGitState): string {
  const suffix = state.nextObjectId.toString(16)
  state.nextObjectId += 1
  return suffix.padStart(40, 'e')
}

export function renameRef(state: ManualGitState, oldName: string, newName: string): void {
  state.commits = state.commits.map((commit) =>
    updateCommitRefs(
      commit,
      refsForCommit(commit).map((ref) => {
        if (ref === oldName) {
          return newName
        }
        if (ref === `HEAD -> ${oldName}`) {
          return `HEAD -> ${newName}`
        }
        return ref
      })
    )
  )
}

export function deleteRef(state: ManualGitState, refName: string): void {
  state.commits = state.commits.map((commit) =>
    updateCommitRefs(
      commit,
      refsForCommit(commit).filter((ref) => ref !== refName && ref !== `tag: ${refName}`)
    )
  )
}

export function makeDiff(file: string): string {
  return `${[
    `diff --git a/${file} b/${file}`,
    'index 1111111..2222222 100644',
    `--- a/${file}`,
    `+++ b/${file}`,
    '@@ -18,3 +18,4 @@ export default function App() {',
    '   return (',
    '-    <TabsShell />',
    '+    <TabsShell persisted={persistedTabs} />',
    '+    <Toaster position="bottom-right" />',
    '   )'
  ].join('\n')}\n`
}

export function updateFileCodesAfterCommit(file: StatusFileCode): StatusFileCode | null {
  if (file.working_dir === ' ') {
    return null
  }
  return { ...file, index: ' ' }
}
