import { spawn } from 'node:child_process'
import { parseOrThrow } from '@shared/codec'
import {
  type BranchesResponse,
  BranchesResponseSchema,
  type CheckoutResponse,
  CheckoutResponseSchema,
  type CommitResponse,
  CommitResponseSchema,
  type ConflictableMutationResponse,
  ConflictableMutationResponseSchema,
  type FetchResponse,
  FetchResponseSchema,
  type GetDiffResponse,
  GetDiffResponseSchema,
  type GitMutationResponse,
  GitMutationResponseSchema,
  type LocalBranchesResponse,
  LocalBranchesResponseSchema,
  type LogResponse,
  LogResponseSchema,
  type OpenRepoResponse,
  OpenRepoResponseSchema,
  type PullResponse,
  PullResponseSchema,
  type PushResponse,
  PushResponseSchema,
  type RemoteRefsResponse,
  RemoteRefsResponseSchema,
  type ResetMode,
  type StageHunkResponse,
  StageHunkResponseSchema,
  type StageResponse,
  StageResponseSchema,
  type StashListResponse,
  StashListResponseSchema,
  type StatusResponse,
  StatusResponseSchema,
  type UnstageResponse,
  UnstageResponseSchema
} from '@shared/schemas/ipc'
import { fetchSemaphoreFor, releaseFetchSemaphore } from './fetch-semaphore'
import { deriveLocalShortName } from './git/checkout'
import { resolveDefaultBranch } from './git/defaultBranch'
import { buildHunkPatch, parseUnifiedDiff, toFileDiff } from './git/diff'
import { getOrCreateGit, lookupGit, normalizeRepoPath } from './git/instances'
import { LOG_FORMAT, parseGitLogOutput } from './git/log-format'
import { serializeRemotes, serializeStatus } from './git/serialize'
import {
  LOCAL_BRANCH_FORMAT,
  parseLocalBranchRefs,
  parseRemoteAndTagRefs,
  REMOTE_AND_TAG_FORMAT
} from './git/tracking'
import { withRepoLock } from './repo-lock'
import { activeFetches, commitGraphWrites, gitInstances } from './state'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

const INVALID_REPO_PATH = 'invalid repository path'

function isSafeCheckoutRef(ref: string): boolean {
  return ref.length > 0 && !ref.includes('\0') && !ref.startsWith('-')
}

export function openRepoRejected(message: string = INVALID_REPO_PATH): OpenRepoResponse {
  return parseOrThrow(OpenRepoResponseSchema, { _tag: 'GitError', message })
}

export const invalidRepoPath = {
  branches: () =>
    parseOrThrow(BranchesResponseSchema, { _tag: 'GitError', message: INVALID_REPO_PATH }),
  localBranches: () =>
    parseOrThrow(LocalBranchesResponseSchema, { _tag: 'GitError', message: INVALID_REPO_PATH }),
  remoteRefs: () =>
    parseOrThrow(RemoteRefsResponseSchema, { _tag: 'GitError', message: INVALID_REPO_PATH }),
  checkout: () =>
    parseOrThrow(CheckoutResponseSchema, { _tag: 'GitError', message: INVALID_REPO_PATH }),
  commit: () =>
    parseOrThrow(CommitResponseSchema, { _tag: 'GitError', message: INVALID_REPO_PATH }),
  fetch: () => parseOrThrow(FetchResponseSchema, { _tag: 'GitError', message: INVALID_REPO_PATH }),
  push: () => parseOrThrow(PushResponseSchema, { _tag: 'GitError', message: INVALID_REPO_PATH }),
  pull: () => parseOrThrow(PullResponseSchema, { _tag: 'GitError', message: INVALID_REPO_PATH }),
  log: () => parseOrThrow(LogResponseSchema, { _tag: 'GitError', message: INVALID_REPO_PATH }),
  stage: () => parseOrThrow(StageResponseSchema, { _tag: 'GitError', message: INVALID_REPO_PATH }),
  status: () =>
    parseOrThrow(StatusResponseSchema, { _tag: 'GitError', message: INVALID_REPO_PATH }),
  unstage: () =>
    parseOrThrow(UnstageResponseSchema, { _tag: 'GitError', message: INVALID_REPO_PATH }),
  diff: () => parseOrThrow(GetDiffResponseSchema, { _tag: 'GitError', message: INVALID_REPO_PATH }),
  stageHunk: () =>
    parseOrThrow(StageHunkResponseSchema, { _tag: 'GitError', message: INVALID_REPO_PATH }),
  mutation: () =>
    parseOrThrow(GitMutationResponseSchema, { _tag: 'GitError', message: INVALID_REPO_PATH }),
  conflictable: () =>
    parseOrThrow(ConflictableMutationResponseSchema, {
      _tag: 'GitError',
      message: INVALID_REPO_PATH
    }),
  stashList: () =>
    parseOrThrow(StashListResponseSchema, { _tag: 'GitError', message: INVALID_REPO_PATH })
}

const commitGraphWritten = new Set<string>()

// Generation numbers from a commit-graph file make `git log --topo-order` stream
// incrementally instead of walking the full history before the first row.
function ensureCommitGraph(key: string): void {
  if (commitGraphWritten.has(key)) {
    return
  }
  commitGraphWritten.add(key)
  const proc = spawn('git', ['-C', key, 'commit-graph', 'write', '--reachable', '--split'], {
    stdio: 'ignore',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
  })
  commitGraphWrites.set(key, proc)
  proc.on('error', () => {
    commitGraphWrites.delete(key)
  })
  proc.on('close', () => {
    commitGraphWrites.delete(key)
  })
}

export async function openRepo(repoPath: string): Promise<OpenRepoResponse> {
  const key = normalizeRepoPath(repoPath)
  try {
    const git = getOrCreateGit(gitInstances, key)
    const isRepo = await git.checkIsRepo()
    if (!isRepo) {
      gitInstances.delete(key)
      return parseOrThrow(OpenRepoResponseSchema, { _tag: 'NotARepo' })
    }
    ensureCommitGraph(key)
    const [remotes, defaultBranch] = await Promise.all([
      git.getRemotes(true),
      resolveDefaultBranch(git, undefined)
    ])
    return parseOrThrow(OpenRepoResponseSchema, {
      _tag: 'Ok',
      result: { remotes: serializeRemotes(remotes), defaultBranch, path: key }
    })
  } catch (error) {
    return parseOrThrow(OpenRepoResponseSchema, { _tag: 'GitError', message: errorMessage(error) })
  }
}

export async function closeRepo(repoPath: string): Promise<Record<string, never>> {
  const key = normalizeRepoPath(repoPath)
  gitInstances.delete(key)
  const proc = activeFetches.get(key)
  if (proc && !proc.killed) {
    proc.kill()
  }
  activeFetches.delete(key)
  const graphProc = commitGraphWrites.get(key)
  if (graphProc && !graphProc.killed) {
    graphProc.kill()
  }
  commitGraphWrites.delete(key)
  releaseFetchSemaphore(key)
  return {}
}

export async function getLocalBranches(repoPath: string): Promise<LocalBranchesResponse> {
  const git = lookupGit(gitInstances, repoPath)
  if (!git) {
    return parseOrThrow(LocalBranchesResponseSchema, { _tag: 'RepoNotOpen' })
  }
  try {
    const raw = await git.raw(['for-each-ref', 'refs/heads', `--format=${LOCAL_BRANCH_FORMAT}`])
    return parseOrThrow(LocalBranchesResponseSchema, {
      _tag: 'Ok',
      branches: parseLocalBranchRefs(raw)
    })
  } catch (error) {
    return parseOrThrow(LocalBranchesResponseSchema, {
      _tag: 'GitError',
      message: errorMessage(error)
    })
  }
}

export async function getRemoteRefs(repoPath: string): Promise<RemoteRefsResponse> {
  const git = lookupGit(gitInstances, repoPath)
  if (!git) {
    return parseOrThrow(RemoteRefsResponseSchema, { _tag: 'RepoNotOpen' })
  }
  try {
    const raw = await git.raw([
      'for-each-ref',
      'refs/remotes',
      'refs/tags',
      `--format=${REMOTE_AND_TAG_FORMAT}`
    ])
    return parseOrThrow(RemoteRefsResponseSchema, {
      _tag: 'Ok',
      refs: parseRemoteAndTagRefs(raw)
    })
  } catch (error) {
    return parseOrThrow(RemoteRefsResponseSchema, {
      _tag: 'GitError',
      message: errorMessage(error)
    })
  }
}

export async function getBranches(repoPath: string): Promise<BranchesResponse> {
  const git = lookupGit(gitInstances, repoPath)
  if (!git) {
    return parseOrThrow(BranchesResponseSchema, { _tag: 'RepoNotOpen' })
  }
  try {
    const [localResult, remoteResult] = await Promise.all([
      getLocalBranches(repoPath),
      getRemoteRefs(repoPath)
    ])
    if (localResult._tag === 'RepoNotOpen' || remoteResult._tag === 'RepoNotOpen') {
      return parseOrThrow(BranchesResponseSchema, { _tag: 'RepoNotOpen' })
    }
    if (localResult._tag === 'GitError') {
      return parseOrThrow(BranchesResponseSchema, {
        _tag: 'GitError',
        message: localResult.message
      })
    }
    if (remoteResult._tag === 'GitError') {
      return parseOrThrow(BranchesResponseSchema, {
        _tag: 'GitError',
        message: remoteResult.message
      })
    }
    return parseOrThrow(BranchesResponseSchema, {
      _tag: 'Ok',
      branches: {
        ...localResult.branches,
        ...remoteResult.refs
      }
    })
  } catch (error) {
    return parseOrThrow(BranchesResponseSchema, { _tag: 'GitError', message: errorMessage(error) })
  }
}

export async function getStatus(repoPath: string): Promise<StatusResponse> {
  const git = lookupGit(gitInstances, repoPath)
  if (!git) {
    return parseOrThrow(StatusResponseSchema, { _tag: 'RepoNotOpen' })
  }
  try {
    const status = await git.status()
    return parseOrThrow(StatusResponseSchema, { _tag: 'Ok', status: serializeStatus(status) })
  } catch (error) {
    return parseOrThrow(StatusResponseSchema, { _tag: 'GitError', message: errorMessage(error) })
  }
}

export async function stageFile(repoPath: string, file: string): Promise<StageResponse> {
  const git = lookupGit(gitInstances, repoPath)
  if (!git) {
    return parseOrThrow(StageResponseSchema, { _tag: 'RepoNotOpen' })
  }
  return withRepoLock(repoPath, async () => {
    try {
      await git.add(file)
      return parseOrThrow(StageResponseSchema, { _tag: 'Ok' })
    } catch (error) {
      return parseOrThrow(StageResponseSchema, { _tag: 'GitError', message: errorMessage(error) })
    }
  })
}

export async function unstageFile(repoPath: string, file: string): Promise<UnstageResponse> {
  const git = lookupGit(gitInstances, repoPath)
  if (!git) {
    return parseOrThrow(UnstageResponseSchema, { _tag: 'RepoNotOpen' })
  }
  return withRepoLock(repoPath, async () => {
    try {
      await git.reset(['HEAD', file])
      return parseOrThrow(UnstageResponseSchema, { _tag: 'Ok' })
    } catch (error) {
      return parseOrThrow(UnstageResponseSchema, { _tag: 'GitError', message: errorMessage(error) })
    }
  })
}

export async function stageAll(repoPath: string, files: string[]): Promise<StageResponse> {
  const git = lookupGit(gitInstances, repoPath)
  if (!git) {
    return parseOrThrow(StageResponseSchema, { _tag: 'RepoNotOpen' })
  }
  if (files.length === 0) {
    return parseOrThrow(StageResponseSchema, { _tag: 'Ok' })
  }
  return withRepoLock(repoPath, async () => {
    try {
      await git.add(files)
      return parseOrThrow(StageResponseSchema, { _tag: 'Ok' })
    } catch (error) {
      return parseOrThrow(StageResponseSchema, { _tag: 'GitError', message: errorMessage(error) })
    }
  })
}

export async function unstageAll(repoPath: string, files: string[]): Promise<UnstageResponse> {
  const git = lookupGit(gitInstances, repoPath)
  if (!git) {
    return parseOrThrow(UnstageResponseSchema, { _tag: 'RepoNotOpen' })
  }
  if (files.length === 0) {
    return parseOrThrow(UnstageResponseSchema, { _tag: 'Ok' })
  }
  return withRepoLock(repoPath, async () => {
    try {
      await git.reset(['HEAD', '--', ...files])
      return parseOrThrow(UnstageResponseSchema, { _tag: 'Ok' })
    } catch (error) {
      return parseOrThrow(UnstageResponseSchema, { _tag: 'GitError', message: errorMessage(error) })
    }
  })
}

const DIFF_BASE_ARGS = ['--no-color', '--no-ext-diff', '--unified=3']

async function readFileDiff(repoPath: string, file: string, staged: boolean): Promise<string> {
  const args = ['-C', repoPath, 'diff', ...DIFF_BASE_ARGS]
  if (staged) {
    args.push('--cached')
  }
  args.push('--', file)
  return runGit(args)
}

async function isUntracked(repoPath: string, file: string): Promise<boolean> {
  const out = await runGit(['-C', repoPath, 'status', '--porcelain', '--', file])
  return out.startsWith('??')
}

async function readUntrackedDiff(repoPath: string, file: string): Promise<string> {
  return runGit(
    ['-C', repoPath, 'diff', ...DIFF_BASE_ARGS, '--no-index', '--', '/dev/null', file],
    { okExitCodes: [0, 1] }
  )
}

export async function getDiff(
  repoPath: string,
  file: string,
  staged: boolean
): Promise<GetDiffResponse> {
  if (!lookupGit(gitInstances, repoPath)) {
    return parseOrThrow(GetDiffResponseSchema, { _tag: 'RepoNotOpen' })
  }
  try {
    let raw = await readFileDiff(repoPath, file, staged)
    if (!raw && !staged && (await isUntracked(repoPath, file))) {
      raw = await readUntrackedDiff(repoPath, file)
    }
    return parseOrThrow(GetDiffResponseSchema, {
      _tag: 'Ok',
      diff: toFileDiff(file, parseUnifiedDiff(raw))
    })
  } catch (error) {
    return parseOrThrow(GetDiffResponseSchema, { _tag: 'GitError', message: errorMessage(error) })
  }
}

async function applyHunk(
  repoPath: string,
  file: string,
  hunkHeader: string,
  direction: 'stage' | 'unstage'
): Promise<StageHunkResponse> {
  if (!lookupGit(gitInstances, repoPath)) {
    return parseOrThrow(StageHunkResponseSchema, { _tag: 'RepoNotOpen' })
  }
  return withRepoLock(repoPath, async () => {
    try {
      const raw = await readFileDiff(repoPath, file, direction === 'unstage')
      const patch = buildHunkPatch(parseUnifiedDiff(raw), hunkHeader)
      if (!patch) {
        return parseOrThrow(StageHunkResponseSchema, { _tag: 'HunkNotFound' })
      }
      const applyArgs = ['-C', repoPath, 'apply', '--cached', '--whitespace=nowarn']
      if (direction === 'unstage') {
        applyArgs.push('-R')
      }
      applyArgs.push('-')
      await runGit(applyArgs, { stdin: patch })
      return parseOrThrow(StageHunkResponseSchema, { _tag: 'Ok' })
    } catch (error) {
      return parseOrThrow(StageHunkResponseSchema, {
        _tag: 'GitError',
        message: errorMessage(error)
      })
    }
  })
}

export async function stageHunk(
  repoPath: string,
  file: string,
  hunkHeader: string
): Promise<StageHunkResponse> {
  return applyHunk(repoPath, file, hunkHeader, 'stage')
}

export async function unstageHunk(
  repoPath: string,
  file: string,
  hunkHeader: string
): Promise<StageHunkResponse> {
  return applyHunk(repoPath, file, hunkHeader, 'unstage')
}

export async function commit(repoPath: string, message: string): Promise<CommitResponse> {
  const git = lookupGit(gitInstances, repoPath)
  if (!git) {
    return parseOrThrow(CommitResponseSchema, { _tag: 'RepoNotOpen' })
  }
  return withRepoLock(repoPath, async () => {
    try {
      const result = await git.commit(message)
      return parseOrThrow(CommitResponseSchema, {
        _tag: 'Ok',
        result: {
          commit: result.commit,
          branch: result.branch,
          summary: { ...result.summary }
        }
      })
    } catch (error) {
      return parseOrThrow(CommitResponseSchema, { _tag: 'GitError', message: errorMessage(error) })
    }
  })
}

interface RunGitOptions {
  okExitCodes?: number[]
  stdin?: string
}

function runGit(args: string[], options?: RunGitOptions): Promise<string> {
  const okExitCodes = options?.okExitCodes ?? [0]
  return new Promise((resolve, reject) => {
    const proc = spawn('git', args, {
      stdio: [options?.stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''

    proc.stdout?.setEncoding('utf8')
    proc.stdout?.on('data', (chunk: string) => {
      stdout += chunk
    })

    proc.stderr?.setEncoding('utf8')
    proc.stderr?.on('data', (chunk: string) => {
      stderr += chunk
      if (stderr.length > 4096) {
        stderr = stderr.slice(-4096)
      }
    })

    if (options?.stdin !== undefined) {
      proc.stdin?.end(options.stdin)
    }

    proc.on('error', reject)
    proc.on('close', (code) => {
      if (code !== null && okExitCodes.includes(code)) {
        resolve(stdout)
        return
      }
      reject(new Error(stderr.trim() || `git exited with code ${code}`))
    })
  })
}

export async function getLog(repoPath: string, maxCount?: number): Promise<LogResponse> {
  if (!lookupGit(gitInstances, repoPath)) {
    return parseOrThrow(LogResponseSchema, { _tag: 'RepoNotOpen' })
  }
  try {
    const args = [
      '-C',
      repoPath,
      'log',
      '-z',
      '--branches',
      '--remotes',
      '--topo-order',
      `--format=${LOG_FORMAT}`
    ]
    if (typeof maxCount === 'number' && maxCount > 0) {
      args.splice(4, 0, `--max-count=${maxCount}`)
    }
    const raw = await runGit(args)
    const all = parseGitLogOutput(raw)
    return parseOrThrow(LogResponseSchema, { _tag: 'Ok', log: { all, total: all.length } })
  } catch (error) {
    return parseOrThrow(LogResponseSchema, { _tag: 'GitError', message: errorMessage(error) })
  }
}

export async function checkoutRef(
  repoPath: string,
  refKind: 'local' | 'remote' | 'tag',
  fullPath: string
): Promise<CheckoutResponse> {
  const git = lookupGit(gitInstances, repoPath)
  if (!git) {
    return parseOrThrow(CheckoutResponseSchema, { _tag: 'RepoNotOpen' })
  }
  if (!isSafeCheckoutRef(fullPath)) {
    return parseOrThrow(CheckoutResponseSchema, {
      _tag: 'GitError',
      message: 'invalid ref name'
    })
  }
  return withRepoLock(repoPath, async () => {
    try {
      let checkedOut: string
      if (refKind === 'remote') {
        try {
          await git.raw(['show-ref', '--verify', `refs/remotes/${fullPath}`])
        } catch {
          return parseOrThrow(CheckoutResponseSchema, {
            _tag: 'GitError',
            message: `Remote branch '${fullPath}' does not exist`
          })
        }
        const shortName = deriveLocalShortName(fullPath)
        const existing = await git.branch(['--list', shortName])
        if (existing.all.length > 0) {
          const upstreamRaw = await git.raw([
            'for-each-ref',
            `refs/heads/${shortName}`,
            '--format=%(upstream:short)'
          ])
          const upstream = upstreamRaw.trim()
          if (upstream !== fullPath) {
            return parseOrThrow(CheckoutResponseSchema, {
              _tag: 'GitError',
              message: `Local branch '${shortName}' tracks ${upstream || 'no remote'}, not ${fullPath}. Resolve manually.`
            })
          }
          await git.checkout([shortName])
        } else {
          await git.checkout(['--track', fullPath])
        }
        checkedOut = shortName
      } else {
        await git.checkout([fullPath])
        checkedOut = fullPath
      }
      return parseOrThrow(CheckoutResponseSchema, { _tag: 'Ok', checkedOut })
    } catch (error) {
      return parseOrThrow(CheckoutResponseSchema, {
        _tag: 'GitError',
        message: errorMessage(error)
      })
    }
  })
}

function runFetch(key: string): Promise<FetchResponse> {
  return new Promise((resolve) => {
    const proc = spawn(
      'git',
      ['-c', 'fetch.writeCommitGraph=true', '-C', key, 'fetch', '--prune'],
      {
        stdio: ['ignore', 'ignore', 'pipe'],
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
      }
    )
    activeFetches.set(key, proc)

    let stderrBuf = ''
    proc.stderr?.setEncoding('utf8')
    proc.stderr?.on('data', (chunk: string) => {
      stderrBuf += chunk
      if (stderrBuf.length > 4096) {
        stderrBuf = stderrBuf.slice(-4096)
      }
    })

    proc.on('error', (err) => {
      if (activeFetches.get(key) === proc) {
        activeFetches.delete(key)
      }
      resolve(parseOrThrow(FetchResponseSchema, { _tag: 'GitError', message: err.message }))
    })

    proc.on('close', (code) => {
      if (activeFetches.get(key) === proc) {
        activeFetches.delete(key)
      }
      if (code === 0) {
        resolve(parseOrThrow(FetchResponseSchema, { _tag: 'Ok' }))
      } else {
        resolve(
          parseOrThrow(FetchResponseSchema, {
            _tag: 'GitError',
            message: stderrBuf.trim() || `git fetch exited with code ${code}`
          })
        )
      }
    })
  })
}

export async function fetchRepo(repoPath: string): Promise<FetchResponse> {
  const key = normalizeRepoPath(repoPath)
  if (!gitInstances.has(key)) {
    return parseOrThrow(FetchResponseSchema, { _tag: 'RepoNotOpen' })
  }
  return withRepoLock(key, async () => {
    const semaphore = fetchSemaphoreFor(key)
    const result = await semaphore.withPermitsIfAvailable(() => runFetch(key))
    if (result === null) {
      return parseOrThrow(FetchResponseSchema, { _tag: 'FetchSkipped' })
    }
    return result
  })
}

function runGitCommand(
  key: string,
  args: string[]
): Promise<{ _tag: 'Ok' } | { _tag: 'GitError'; message: string }> {
  return new Promise((resolve) => {
    const proc = spawn('git', ['-C', key, ...args], {
      stdio: ['ignore', 'ignore', 'pipe'],
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
    })

    let stderrBuf = ''
    proc.stderr?.setEncoding('utf8')
    proc.stderr?.on('data', (chunk: string) => {
      stderrBuf += chunk
      if (stderrBuf.length > 4096) {
        stderrBuf = stderrBuf.slice(-4096)
      }
    })

    proc.on('error', (err) => {
      resolve({ _tag: 'GitError', message: err.message })
    })

    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ _tag: 'Ok' })
      } else {
        resolve({
          _tag: 'GitError',
          message: stderrBuf.trim() || `git ${args[0]} exited with code ${code}`
        })
      }
    })
  })
}

export async function pushRepo(repoPath: string): Promise<PushResponse> {
  const key = normalizeRepoPath(repoPath)
  if (!gitInstances.has(key)) {
    return parseOrThrow(PushResponseSchema, { _tag: 'RepoNotOpen' })
  }
  return withRepoLock(key, async () => {
    const upstream = await runGitCommand(key, [
      'rev-parse',
      '--abbrev-ref',
      '--symbolic-full-name',
      '@{upstream}'
    ])
    const pushArgs =
      upstream._tag === 'Ok' ? ['push'] : ['push', '--set-upstream', 'origin', 'HEAD']
    return parseOrThrow(PushResponseSchema, await runGitCommand(key, pushArgs))
  })
}

export async function pullRepo(repoPath: string): Promise<PullResponse> {
  const key = normalizeRepoPath(repoPath)
  if (!gitInstances.has(key)) {
    return parseOrThrow(PullResponseSchema, { _tag: 'RepoNotOpen' })
  }
  return withRepoLock(key, async () =>
    parseOrThrow(PullResponseSchema, await runGitCommand(key, ['pull', '--ff-only']))
  )
}

// Reject anything that could be read as an option flag (leading '-') or smuggle a NUL. Arguments
// are passed as an array to git (never a shell), so this is the only injection surface that matters.
function isSafeRefArg(value: string): boolean {
  return value.length > 0 && !value.includes('\0') && !value.startsWith('-')
}

type RawGit = { raw: (args: string[]) => Promise<string> }

async function workingTreeHasConflicts(git: RawGit): Promise<boolean> {
  const out = await git.raw(['diff', '--name-only', '--diff-filter=U'])
  return out.trim().length > 0
}

function mutationOk(): GitMutationResponse {
  return parseOrThrow(GitMutationResponseSchema, { _tag: 'Ok' })
}

function mutationError(message: string): GitMutationResponse {
  return parseOrThrow(GitMutationResponseSchema, { _tag: 'GitError', message })
}

export async function createBranch(
  repoPath: string,
  name: string,
  startPoint?: string,
  checkout?: boolean
): Promise<GitMutationResponse> {
  const git = lookupGit(gitInstances, repoPath)
  if (!git) {
    return parseOrThrow(GitMutationResponseSchema, { _tag: 'RepoNotOpen' })
  }
  if (!isSafeRefArg(name) || (startPoint !== undefined && !isSafeRefArg(startPoint))) {
    return mutationError('invalid branch name')
  }
  return withRepoLock(repoPath, async () => {
    try {
      const args = checkout ? ['checkout', '-b', name] : ['branch', name]
      if (startPoint) {
        args.push(startPoint)
      }
      await git.raw(args)
      return mutationOk()
    } catch (error) {
      return mutationError(errorMessage(error))
    }
  })
}

export async function deleteBranch(
  repoPath: string,
  name: string,
  force?: boolean
): Promise<GitMutationResponse> {
  const git = lookupGit(gitInstances, repoPath)
  if (!git) {
    return parseOrThrow(GitMutationResponseSchema, { _tag: 'RepoNotOpen' })
  }
  if (!isSafeRefArg(name)) {
    return mutationError('invalid branch name')
  }
  return withRepoLock(repoPath, async () => {
    try {
      await git.raw(['branch', force ? '-D' : '-d', name])
      return mutationOk()
    } catch (error) {
      return mutationError(errorMessage(error))
    }
  })
}

export async function renameBranch(
  repoPath: string,
  oldName: string,
  newName: string
): Promise<GitMutationResponse> {
  const git = lookupGit(gitInstances, repoPath)
  if (!git) {
    return parseOrThrow(GitMutationResponseSchema, { _tag: 'RepoNotOpen' })
  }
  if (!isSafeRefArg(oldName) || !isSafeRefArg(newName)) {
    return mutationError('invalid branch name')
  }
  return withRepoLock(repoPath, async () => {
    try {
      await git.raw(['branch', '-m', oldName, newName])
      return mutationOk()
    } catch (error) {
      return mutationError(errorMessage(error))
    }
  })
}

// merge/revert/cherry-pick leave the tree conflicted on failure, but simple-git's `raw` does NOT
// reject for a conflicting merge (it resolves while the index holds unmerged entries). So the
// classification has to inspect the index for unmerged paths rather than trusting the thrown error.
async function runWithConflictDetection(
  repoPath: string,
  git: RawGit,
  args: string[]
): Promise<ConflictableMutationResponse> {
  return withRepoLock(repoPath, async () => {
    let failure: string | null = null
    try {
      await git.raw(args)
    } catch (error) {
      failure = errorMessage(error)
    }
    if (await workingTreeHasConflicts(git)) {
      return parseOrThrow(ConflictableMutationResponseSchema, {
        _tag: 'Conflict',
        message: failure ?? `${args[0]} stopped on conflicts`
      })
    }
    if (failure !== null) {
      return parseOrThrow(ConflictableMutationResponseSchema, {
        _tag: 'GitError',
        message: failure
      })
    }
    return parseOrThrow(ConflictableMutationResponseSchema, { _tag: 'Ok' })
  })
}

export async function mergeBranch(
  repoPath: string,
  ref: string
): Promise<ConflictableMutationResponse> {
  const git = lookupGit(gitInstances, repoPath)
  if (!git) {
    return parseOrThrow(ConflictableMutationResponseSchema, { _tag: 'RepoNotOpen' })
  }
  if (!isSafeRefArg(ref)) {
    return parseOrThrow(ConflictableMutationResponseSchema, {
      _tag: 'GitError',
      message: 'invalid ref name'
    })
  }
  return runWithConflictDetection(repoPath, git, ['merge', '--no-edit', ref])
}

export async function resetToCommit(
  repoPath: string,
  sha: string,
  mode: ResetMode
): Promise<GitMutationResponse> {
  const git = lookupGit(gitInstances, repoPath)
  if (!git) {
    return parseOrThrow(GitMutationResponseSchema, { _tag: 'RepoNotOpen' })
  }
  if (!isSafeRefArg(sha)) {
    return mutationError('invalid commit')
  }
  return withRepoLock(repoPath, async () => {
    try {
      await git.raw(['reset', `--${mode}`, sha])
      return mutationOk()
    } catch (error) {
      return mutationError(errorMessage(error))
    }
  })
}

export async function revertCommit(
  repoPath: string,
  sha: string
): Promise<ConflictableMutationResponse> {
  const git = lookupGit(gitInstances, repoPath)
  if (!git) {
    return parseOrThrow(ConflictableMutationResponseSchema, { _tag: 'RepoNotOpen' })
  }
  if (!isSafeRefArg(sha)) {
    return parseOrThrow(ConflictableMutationResponseSchema, {
      _tag: 'GitError',
      message: 'invalid commit'
    })
  }
  return runWithConflictDetection(repoPath, git, ['revert', '--no-edit', sha])
}

export async function cherryPick(
  repoPath: string,
  sha: string
): Promise<ConflictableMutationResponse> {
  const git = lookupGit(gitInstances, repoPath)
  if (!git) {
    return parseOrThrow(ConflictableMutationResponseSchema, { _tag: 'RepoNotOpen' })
  }
  if (!isSafeRefArg(sha)) {
    return parseOrThrow(ConflictableMutationResponseSchema, {
      _tag: 'GitError',
      message: 'invalid commit'
    })
  }
  return runWithConflictDetection(repoPath, git, ['cherry-pick', sha])
}

export async function createTag(
  repoPath: string,
  name: string,
  ref?: string,
  message?: string
): Promise<GitMutationResponse> {
  const git = lookupGit(gitInstances, repoPath)
  if (!git) {
    return parseOrThrow(GitMutationResponseSchema, { _tag: 'RepoNotOpen' })
  }
  if (!isSafeRefArg(name) || (ref !== undefined && !isSafeRefArg(ref))) {
    return mutationError('invalid tag name')
  }
  return withRepoLock(repoPath, async () => {
    try {
      const args = message ? ['tag', '-a', name, '-m', message] : ['tag', name]
      if (ref) {
        args.push(ref)
      }
      await git.raw(args)
      return mutationOk()
    } catch (error) {
      return mutationError(errorMessage(error))
    }
  })
}

export async function deleteTag(repoPath: string, name: string): Promise<GitMutationResponse> {
  const git = lookupGit(gitInstances, repoPath)
  if (!git) {
    return parseOrThrow(GitMutationResponseSchema, { _tag: 'RepoNotOpen' })
  }
  if (!isSafeRefArg(name)) {
    return mutationError('invalid tag name')
  }
  return withRepoLock(repoPath, async () => {
    try {
      await git.raw(['tag', '-d', name])
      return mutationOk()
    } catch (error) {
      return mutationError(errorMessage(error))
    }
  })
}

const STASH_FIELD_SEP = '\x1f'

interface ParsedStash {
  index: number
  ref: string
  message: string
  branch: string
}

function parseStashList(raw: string): ParsedStash[] {
  const stashes: ParsedStash[] = []
  for (const line of raw.split('\n')) {
    if (!line) {
      continue
    }
    const [ref, subject = ''] = line.split(STASH_FIELD_SEP)
    const indexMatch = ref.match(/^stash@\{(\d+)\}$/)
    if (!indexMatch) {
      continue
    }
    const subjectMatch = subject.match(/^(?:WIP on|On) ([^:]+): (.*)$/)
    stashes.push({
      index: Number(indexMatch[1]),
      ref,
      branch: subjectMatch ? subjectMatch[1] : '',
      message: subjectMatch ? subjectMatch[2] : subject
    })
  }
  return stashes
}

export async function stashList(repoPath: string): Promise<StashListResponse> {
  const git = lookupGit(gitInstances, repoPath)
  if (!git) {
    return parseOrThrow(StashListResponseSchema, { _tag: 'RepoNotOpen' })
  }
  try {
    const raw = await git.raw(['stash', 'list', `--format=%gd${STASH_FIELD_SEP}%gs`])
    return parseOrThrow(StashListResponseSchema, { _tag: 'Ok', stashes: parseStashList(raw) })
  } catch (error) {
    return parseOrThrow(StashListResponseSchema, { _tag: 'GitError', message: errorMessage(error) })
  }
}

export async function stashPush(
  repoPath: string,
  message?: string,
  includeUntracked?: boolean,
  files?: string[]
): Promise<GitMutationResponse> {
  const git = lookupGit(gitInstances, repoPath)
  if (!git) {
    return parseOrThrow(GitMutationResponseSchema, { _tag: 'RepoNotOpen' })
  }
  if (files?.some((file) => !isSafeRefArg(file))) {
    return mutationError('invalid file path')
  }
  return withRepoLock(repoPath, async () => {
    try {
      const args = ['stash', 'push']
      if (includeUntracked) {
        args.push('--include-untracked')
      }
      if (message) {
        args.push('-m', message)
      }
      if (files && files.length > 0) {
        args.push('--', ...files)
      }
      await git.raw(args)
      return mutationOk()
    } catch (error) {
      return mutationError(errorMessage(error))
    }
  })
}

function stashRef(index: number): string | null {
  return Number.isInteger(index) && index >= 0 ? `stash@{${index}}` : null
}

export async function stashApply(
  repoPath: string,
  index: number
): Promise<ConflictableMutationResponse> {
  const git = lookupGit(gitInstances, repoPath)
  if (!git) {
    return parseOrThrow(ConflictableMutationResponseSchema, { _tag: 'RepoNotOpen' })
  }
  const ref = stashRef(index)
  if (!ref) {
    return parseOrThrow(ConflictableMutationResponseSchema, {
      _tag: 'GitError',
      message: 'invalid stash index'
    })
  }
  return runWithConflictDetection(repoPath, git, ['stash', 'apply', ref])
}

export async function stashPop(
  repoPath: string,
  index: number
): Promise<ConflictableMutationResponse> {
  const git = lookupGit(gitInstances, repoPath)
  if (!git) {
    return parseOrThrow(ConflictableMutationResponseSchema, { _tag: 'RepoNotOpen' })
  }
  const ref = stashRef(index)
  if (!ref) {
    return parseOrThrow(ConflictableMutationResponseSchema, {
      _tag: 'GitError',
      message: 'invalid stash index'
    })
  }
  return runWithConflictDetection(repoPath, git, ['stash', 'pop', ref])
}

export async function stashDrop(repoPath: string, index: number): Promise<GitMutationResponse> {
  const git = lookupGit(gitInstances, repoPath)
  if (!git) {
    return parseOrThrow(GitMutationResponseSchema, { _tag: 'RepoNotOpen' })
  }
  const ref = stashRef(index)
  if (!ref) {
    return mutationError('invalid stash index')
  }
  return withRepoLock(repoPath, async () => {
    try {
      await git.raw(['stash', 'drop', ref])
      return mutationOk()
    } catch (error) {
      return mutationError(errorMessage(error))
    }
  })
}

// Discard local edits to the given paths: untracked paths are deleted, tracked paths are restored
// to their committed/index baseline. The two cases need different git verbs, so classify first.
export async function discardChanges(
  repoPath: string,
  files: string[]
): Promise<GitMutationResponse> {
  const git = lookupGit(gitInstances, repoPath)
  if (!git) {
    return parseOrThrow(GitMutationResponseSchema, { _tag: 'RepoNotOpen' })
  }
  if (files.length === 0) {
    return mutationOk()
  }
  if (files.some((file) => !isSafeRefArg(file))) {
    return mutationError('invalid file path')
  }
  return withRepoLock(repoPath, async () => {
    try {
      const statusRaw = await git.raw(['status', '--porcelain', '--', ...files])
      const untracked = new Set<string>()
      for (const line of statusRaw.split('\n')) {
        if (line.startsWith('??')) {
          untracked.add(line.slice(3))
        }
      }
      const tracked = files.filter((file) => !untracked.has(file))
      if (tracked.length > 0) {
        await git.raw(['restore', '--', ...tracked])
      }
      if (untracked.size > 0) {
        await git.raw(['clean', '-fd', '--', ...untracked])
      }
      return mutationOk()
    } catch (error) {
      return mutationError(errorMessage(error))
    }
  })
}

export async function discardAll(repoPath: string): Promise<GitMutationResponse> {
  const git = lookupGit(gitInstances, repoPath)
  if (!git) {
    return parseOrThrow(GitMutationResponseSchema, { _tag: 'RepoNotOpen' })
  }
  return withRepoLock(repoPath, async () => {
    try {
      await git.raw(['reset', '--hard', 'HEAD'])
      await git.raw(['clean', '-fd'])
      return mutationOk()
    } catch (error) {
      return mutationError(errorMessage(error))
    }
  })
}
