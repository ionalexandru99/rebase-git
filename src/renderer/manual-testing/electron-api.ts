import type {
  GitLogEntry,
  GitStatus,
  LogChunk,
  RepoChangedEvent,
  StatusFileCode
} from '@shared/schemas/git'
import { GIT_LOG_REF_SEPARATOR } from '@shared/schemas/git'
import type { LogStreamOptions } from '@shared/schemas/log-stream'
import type { IElectronAPI } from '../../preload'

export const PLAYWRIGHT_MCP_WORKSPACE_PATH = '/Users/playwright/Projects'
export const PLAYWRIGHT_MCP_REPO_PATH = `${PLAYWRIGHT_MCP_WORKSPACE_PATH}/rebase-demo`

export interface PlaywrightMcpElectronApiOptions {
  onboardingComplete?: boolean
  historyCount?: number
  conflicted?: boolean
}

type MutableGitStatus = {
  -readonly [Key in keyof GitStatus]: GitStatus[Key]
}

interface ManualState {
  activeWorkspace: string | null
  branches: string[]
  commits: GitLogEntry[]
  onboardingComplete: boolean
  nextObjectId: number
  persistedTabs: { tabs: Array<string | null>; activeIndex: number }
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

function cloneStatus(status: GitStatus): MutableGitStatus {
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

function createState(options: PlaywrightMcpElectronApiOptions): ManualState {
  const onboardingComplete = options.onboardingComplete ?? true
  const status = cloneStatus(initialStatus)
  if (options.conflicted) {
    status.conflicted.push('src/conflict.ts')
    status.files.push({ path: 'src/conflict.ts', index: 'U', working_dir: 'U' })
  }
  return {
    activeWorkspace: onboardingComplete ? PLAYWRIGHT_MCP_WORKSPACE_PATH : null,
    branches: ['main', 'feature/streaming', 'fix/window-state'],
    commits: createManualCommits(options.historyCount ?? initialCommits.length),
    onboardingComplete,
    nextObjectId: 1,
    persistedTabs: {
      tabs: [null],
      activeIndex: 0
    },
    recentRepos: [PLAYWRIGHT_MCP_REPO_PATH],
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
    workspaces: onboardingComplete ? [PLAYWRIGHT_MCP_WORKSPACE_PATH] : []
  }
}

function without(values: string[], value: string): string[] {
  return values.filter((candidate) => candidate !== value)
}

function withValue(values: string[], value: string): string[] {
  return values.includes(value) ? values : [...values, value]
}

function bodyString(body: Record<string, unknown>, key: string): string {
  const value = body[key]
  return typeof value === 'string' ? value : ''
}

function bodyStrings(body: Record<string, unknown>, key: string): string[] {
  const value = body[key]
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : []
}

function stageFile(state: ManualState, file: string): void {
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

function unstageFile(state: ManualState, file: string): void {
  state.status.staged = without(state.status.staged, file)
  state.status.modified = withValue(state.status.modified, file)
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

function removeFiles(state: ManualState, files: string[]): void {
  const removed = new Set(files)
  state.status.modified = state.status.modified.filter((file) => !removed.has(file))
  state.status.staged = state.status.staged.filter((file) => !removed.has(file))
  state.status.not_added = state.status.not_added.filter((file) => !removed.has(file))
  state.status.conflicted = state.status.conflicted.filter((file) => !removed.has(file))
  state.status.deleted = state.status.deleted.filter((file) => !removed.has(file))
  state.status.created = state.status.created.filter((file) => !removed.has(file))
  state.status.files = state.status.files.filter((file) => !removed.has(file.path))
}

function captureFiles(state: ManualState, files: string[]): StashedFile[] {
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

function restoreFiles(state: ManualState, files: StashedFile[]): void {
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

function reindexStashes(stashes: ManualStash[]): ManualStash[] {
  return stashes.map((stash, index) => ({ ...stash, index, ref: `stash@{${index}}` }))
}

function refsForCommit(commit: GitLogEntry): string[] {
  return commit.refs ? commit.refs.split(GIT_LOG_REF_SEPARATOR) : []
}

function findRefCommitIndex(state: ManualState, ref: string | undefined): number {
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

function updateCommitRefs(commit: GitLogEntry, refs: string[]): GitLogEntry {
  return { ...commit, refs: refs.join(GIT_LOG_REF_SEPARATOR) }
}

function moveHead(state: ManualState, branch: string): void {
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

function addRef(state: ManualState, commitIndex: number, ref: string): void {
  state.commits[commitIndex] = updateCommitRefs(
    state.commits[commitIndex],
    withValue(refsForCommit(state.commits[commitIndex]), ref)
  )
}

function nextObjectId(state: ManualState): string {
  const suffix = state.nextObjectId.toString(16)
  state.nextObjectId += 1
  return suffix.padStart(40, 'e')
}

function renameRef(state: ManualState, oldName: string, newName: string): void {
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

function deleteRef(state: ManualState, refName: string): void {
  state.commits = state.commits.map((commit) =>
    updateCommitRefs(
      commit,
      refsForCommit(commit).filter((ref) => ref !== refName && ref !== `tag: ${refName}`)
    )
  )
}

function makeDiff(file: string) {
  return {
    filePath: file,
    binary: false,
    hunks: [
      {
        header: '@@ -18,3 +18,4 @@ export default function App() {',
        oldStart: 18,
        oldCount: 3,
        newStart: 18,
        newCount: 4,
        lines: [
          { kind: 'context' as const, text: '   return (', oldLine: 18, newLine: 18 },
          { kind: 'del' as const, text: '-    <TabsShell />', oldLine: 19, newLine: null },
          {
            kind: 'add' as const,
            text: '+    <TabsShell persisted={persistedTabs} />',
            oldLine: null,
            newLine: 19
          },
          {
            kind: 'add' as const,
            text: '+    <Toaster position="bottom-right" />',
            oldLine: null,
            newLine: 20
          },
          { kind: 'context' as const, text: '   )', oldLine: 20, newLine: 21 }
        ]
      }
    ]
  }
}

function updateFileCodesAfterCommit(file: StatusFileCode): StatusFileCode | null {
  if (file.working_dir === ' ') {
    return null
  }
  return { ...file, index: ' ' }
}

export function createPlaywrightMcpElectronApi(
  options: PlaywrightMcpElectronApiOptions = {}
): IElectronAPI {
  const state = createState(options)
  const logListeners = new Set<(chunk: LogChunk) => void>()
  const repoListeners = new Set<(event: RepoChangedEvent) => void>()
  const restartListeners = new Set<() => void>()

  const notifyRepoChanged = (kind: RepoChangedEvent['kind']): void => {
    const event = { repoPath: PLAYWRIGHT_MCP_REPO_PATH, kind }
    for (const listener of repoListeners) {
      listener(event)
    }
  }

  const ok = { _tag: 'Ok' as const }

  return {
    platform: 'darwin',
    selectFolder: async () => PLAYWRIGHT_MCP_WORKSPACE_PATH,
    openRepo: async (repoPath) => {
      if (repoPath !== PLAYWRIGHT_MCP_REPO_PATH) {
        return { _tag: 'NotARepo' }
      }
      return {
        _tag: 'Ok',
        result: {
          remotes: { origin: 'git@github.com:example/rebase-demo.git' },
          defaultBranch: 'main',
          path: PLAYWRIGHT_MCP_REPO_PATH
        }
      }
    },
    closeRepo: async () => {},
    disownRepo: async () => {},
    startLogStream: async (repoPath: string, streamOptions?: LogStreamOptions) => {
      if (repoPath !== PLAYWRIGHT_MCP_REPO_PATH) {
        return { _tag: 'GitError', message: `Repository is not open: ${repoPath}` }
      }
      const skip = streamOptions?.skip ?? 0
      const maxCount = streamOptions?.maxCount ?? state.commits.length
      const commits = state.commits
        .slice(skip, skip + maxCount)
        .map((commit) => ({ ...commit, parents: [...commit.parents] }))
      queueMicrotask(() => {
        const chunk = {
          repoPath,
          commits,
          done: true,
          hasMore: skip + commits.length < state.commits.length,
          streamId: streamOptions?.streamId
        }
        for (const listener of logListeners) {
          listener(chunk)
        }
      })
      return ok
    },
    cancelLogStream: async () => ({}),
    onLogChunk: (callback) => {
      logListeners.add(callback)
      return () => logListeners.delete(callback)
    },
    onRepoChanged: (callback) => {
      repoListeners.add(callback)
      return () => repoListeners.delete(callback)
    },
    onSidecarRestarted: (callback) => {
      restartListeners.add(callback)
      return () => restartListeners.delete(callback)
    },
    getRecentRepos: async () => [...state.recentRepos],
    getSidebarPrefs: async () => ({ ...state.sidebarPrefs }),
    setSidebarPrefs: async (prefs) => {
      state.sidebarPrefs = { ...prefs }
    },
    getRefTreeToggles: async () => [...state.refTreeToggles],
    setRefTreeToggles: async (toggles) => {
      state.refTreeToggles = [...toggles]
    },
    getPersistedTabs: async () => ({
      tabs: [...state.persistedTabs.tabs],
      activeIndex: state.persistedTabs.activeIndex
    }),
    setPersistedTabs: async (persistedTabs) => {
      state.persistedTabs = {
        tabs: [...persistedTabs.tabs],
        activeIndex: persistedTabs.activeIndex
      }
    },
    getWorkspaces: async () => [...state.workspaces],
    addWorkspace: async (workspacePath) => {
      state.workspaces = withValue(state.workspaces, workspacePath)
      state.activeWorkspace = workspacePath
      return [...state.workspaces]
    },
    removeWorkspace: async (workspacePath) => {
      state.workspaces = without(state.workspaces, workspacePath)
      if (state.activeWorkspace === workspacePath) {
        state.activeWorkspace = state.workspaces[0] ?? null
      }
      return [...state.workspaces]
    },
    getActiveWorkspace: async () => state.activeWorkspace,
    setActiveWorkspace: async (workspacePath) => {
      state.activeWorkspace = workspacePath
    },
    getOnboardingComplete: async () => state.onboardingComplete,
    setOnboardingComplete: async (complete) => {
      state.onboardingComplete = complete
    },
    scanForRepos: async () => ({ _tag: 'Ok', repos: [PLAYWRIGHT_MCP_REPO_PATH] }),
    openHelpLink: async () => {},
    sidecarRequest: async (operation, body) => {
      const repoPath = bodyString(body, 'repoPath')
      if (repoPath && repoPath !== PLAYWRIGHT_MCP_REPO_PATH) {
        return { _tag: 'RepoNotOpen' }
      }

      switch (operation) {
        case 'getStatus':
          return { ...ok, status: cloneStatus(state.status) }
        case 'getLocalBranches':
          return {
            ...ok,
            branches: {
              current: state.status.current,
              all: [...state.branches],
              tracking: { main: { ahead: 1, behind: 0 } }
            }
          }
        case 'getRemoteRefs':
          return {
            ...ok,
            refs: {
              remotes: ['origin/main', 'origin/feature/streaming'],
              tags: [...state.tags]
            }
          }
        case 'getDiff':
          return { ...ok, diff: makeDiff(bodyString(body, 'file')) }
        case 'getHeadCommit': {
          const head = state.commits[findRefCommitIndex(state, undefined)]
          return {
            ...ok,
            result: {
              sha: head.hash,
              message: head.message,
              files: [
                { status: 'M', path: 'src/main/index.ts' },
                { status: 'A', path: 'src/renderer/manual-testing/electron-api.ts' }
              ],
              parentCount: head.parents.length
            }
          }
        }
        case 'stashList':
          return {
            ...ok,
            stashes: state.stashes.map(({ files: _, ...stash }) => ({ ...stash }))
          }
        case 'stageFile':
        case 'stageHunk':
          stageFile(state, bodyString(body, 'file'))
          notifyRepoChanged('index')
          return ok
        case 'stageAll':
          for (const file of bodyStrings(body, 'files')) {
            stageFile(state, file)
          }
          notifyRepoChanged('index')
          return ok
        case 'unstageFile':
        case 'unstageHunk':
          unstageFile(state, bodyString(body, 'file'))
          notifyRepoChanged('index')
          return ok
        case 'unstageAll':
          for (const file of bodyStrings(body, 'files')) {
            unstageFile(state, file)
          }
          notifyRepoChanged('index')
          return ok
        case 'discardChanges':
          removeFiles(state, bodyStrings(body, 'files'))
          notifyRepoChanged('workingTree')
          return ok
        case 'discardAll':
          removeFiles(
            state,
            state.status.files.map((file) => file.path)
          )
          notifyRepoChanged('workingTree')
          return ok
        case 'commit': {
          const message = bodyString(body, 'message')
          const changedFiles = [...state.status.staged]
          const currentHeadIndex = findRefCommitIndex(state, undefined)
          const previousHead = state.commits[currentHeadIndex]
          const hash = nextObjectId(state)
          state.commits = state.commits.map((commit) =>
            updateCommitRefs(
              commit,
              refsForCommit(commit).filter((ref) => !ref.startsWith('HEAD -> '))
            )
          )
          state.commits.unshift({
            hash,
            message,
            author_name: 'Playwright MCP',
            date: new Date().toISOString(),
            parents: [previousHead.hash],
            refs: `HEAD -> ${state.status.current}`
          })
          state.status.staged = []
          state.status.files = state.status.files
            .map(updateFileCodesAfterCommit)
            .filter((file): file is StatusFileCode => file !== null)
          notifyRepoChanged('refs')
          return {
            ...ok,
            result: {
              commit: hash,
              branch: state.status.current,
              summary: { changes: changedFiles.length, insertions: 4, deletions: 1 }
            }
          }
        }
        case 'amendCommit': {
          const message = bodyString(body, 'message')
          const headIndex = findRefCommitIndex(state, undefined)
          state.commits[headIndex] = { ...state.commits[headIndex], message }
          notifyRepoChanged('refs')
          return {
            ...ok,
            result: {
              commit: state.commits[headIndex].hash,
              branch: state.status.current,
              summary: { changes: state.status.staged.length, insertions: 2, deletions: 1 }
            }
          }
        }
        case 'checkout': {
          const checkedOut = bodyString(body, 'fullPath').replace(/^origin\//, '')
          state.status.current = checkedOut
          state.branches = withValue(state.branches, checkedOut)
          moveHead(state, checkedOut)
          notifyRepoChanged('refs')
          return { ...ok, checkedOut }
        }
        case 'createBranch': {
          const branch = bodyString(body, 'name')
          state.branches = withValue(state.branches, branch)
          addRef(
            state,
            findRefCommitIndex(state, bodyString(body, 'startPoint') || undefined),
            branch
          )
          if (body.checkout === true) {
            state.status.current = branch
            moveHead(state, branch)
          }
          notifyRepoChanged('refs')
          return ok
        }
        case 'deleteBranch':
          state.branches = without(state.branches, bodyString(body, 'name'))
          deleteRef(state, bodyString(body, 'name'))
          notifyRepoChanged('refs')
          return ok
        case 'renameBranch': {
          const oldName = bodyString(body, 'oldName')
          const newName = bodyString(body, 'newName')
          state.branches = state.branches.map((branch) => (branch === oldName ? newName : branch))
          renameRef(state, oldName, newName)
          if (state.status.current === oldName) {
            state.status.current = newName
          }
          notifyRepoChanged('refs')
          return ok
        }
        case 'createTag':
          state.tags = withValue(state.tags, bodyString(body, 'name'))
          addRef(
            state,
            findRefCommitIndex(state, bodyString(body, 'ref') || undefined),
            `tag: ${bodyString(body, 'name')}`
          )
          notifyRepoChanged('refs')
          return ok
        case 'deleteTag':
          state.tags = without(state.tags, bodyString(body, 'name'))
          deleteRef(state, bodyString(body, 'name'))
          notifyRepoChanged('refs')
          return ok
        case 'stashDrop': {
          const expectedOid = bodyString(body, 'expectedOid')
          state.stashes = reindexStashes(state.stashes.filter((stash) => stash.oid !== expectedOid))
          return ok
        }
        case 'stashPush': {
          const requestedFiles = bodyStrings(body, 'files')
          const files =
            requestedFiles.length > 0 ? requestedFiles : state.status.files.map((file) => file.path)
          const stashedFiles = captureFiles(state, files)
          removeFiles(state, files)
          state.stashes = reindexStashes([
            {
              index: 0,
              ref: 'stash@{0}',
              oid: nextObjectId(state),
              message: bodyString(body, 'message') || 'WIP on main',
              branch: state.status.current,
              files: stashedFiles
            },
            ...state.stashes
          ])
          notifyRepoChanged('workingTree')
          return ok
        }
        case 'stashPop': {
          const expectedOid = bodyString(body, 'expectedOid')
          const stash = state.stashes.find((entry) => entry.oid === expectedOid)
          if (stash) {
            restoreFiles(state, stash.files)
            state.stashes = reindexStashes(
              state.stashes.filter((entry) => entry.oid !== expectedOid)
            )
          }
          notifyRepoChanged('workingTree')
          return ok
        }
        case 'stashApply': {
          const stash = state.stashes.find((entry) => entry.oid === bodyString(body, 'expectedOid'))
          if (stash) {
            restoreFiles(state, stash.files)
          }
          notifyRepoChanged('workingTree')
          return ok
        }
        case 'fetch':
        case 'push':
        case 'pull':
        case 'mergeBranch':
        case 'revertCommit':
        case 'cherryPick':
        case 'reset':
          notifyRepoChanged('refs')
          return ok
        default:
          return { _tag: 'GitError', message: `Unsupported manual RPC: ${operation}` }
      }
    }
  }
}

export function installPlaywrightMcpElectronApi(
  options: PlaywrightMcpElectronApiOptions = {}
): void {
  window.electronAPI = createPlaywrightMcpElectronApi(options)
}
