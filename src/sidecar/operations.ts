import { spawn } from 'node:child_process'
import { parseOrThrow } from '@shared/codec'
import {
  type BranchesResponse,
  BranchesResponseSchema,
  type CheckoutResponse,
  CheckoutResponseSchema,
  type CommitResponse,
  CommitResponseSchema,
  type FetchResponse,
  FetchResponseSchema,
  type GetDiffResponse,
  GetDiffResponseSchema,
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
  type StageHunkResponse,
  StageHunkResponseSchema,
  type StageResponse,
  StageResponseSchema,
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
import {
  serializeLocalBranches,
  serializeRemoteBranchNames,
  serializeRemotes,
  serializeStatus
} from './git/serialize'
import { parseAheadBehind } from './git/tracking'
import { withRepoLock } from './repo-lock'
import { activeFetches, gitInstances } from './state'

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
    parseOrThrow(StageHunkResponseSchema, { _tag: 'GitError', message: INVALID_REPO_PATH })
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
    const remotes = await git.getRemotes(true)
    const defaultBranch = await resolveDefaultBranch(git, undefined)
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
  releaseFetchSemaphore(key)
  return {}
}

export async function getLocalBranches(repoPath: string): Promise<LocalBranchesResponse> {
  const git = lookupGit(gitInstances, repoPath)
  if (!git) {
    return parseOrThrow(LocalBranchesResponseSchema, { _tag: 'RepoNotOpen' })
  }
  try {
    const [branches, trackingRaw] = await Promise.all([
      git.branch(),
      git.raw(['for-each-ref', 'refs/heads', '--format=%(refname:short)|%(upstream:track)'])
    ])
    const tracking = parseAheadBehind(trackingRaw)
    return parseOrThrow(LocalBranchesResponseSchema, {
      _tag: 'Ok',
      branches: serializeLocalBranches(branches, tracking)
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
    const [branches, tags] = await Promise.all([git.branch(['-r']), git.tags()])
    return parseOrThrow(RemoteRefsResponseSchema, {
      _tag: 'Ok',
      refs: {
        remotes: serializeRemoteBranchNames(branches),
        tags: [...tags.all]
      }
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
    const proc = spawn('git', ['-C', key, 'fetch', '--prune'], {
      stdio: ['ignore', 'ignore', 'pipe'],
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
    })
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
  return withRepoLock(key, async () =>
    parseOrThrow(PushResponseSchema, await runGitCommand(key, ['push']))
  )
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
