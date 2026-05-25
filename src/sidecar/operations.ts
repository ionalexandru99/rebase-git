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
  type LogResponse,
  LogResponseSchema,
  type OpenRepoResponse,
  OpenRepoResponseSchema,
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
import { getOrCreateGit, lookupGit, normalizeRepoPath } from './git/instances'
import {
  GRAPH_LOG_FLAGS,
  GRAPH_LOG_FORMAT,
  serializeBranches,
  serializeLog,
  serializeRemotes,
  serializeStatus
} from './git/serialize'
import { parseAheadBehind } from './git/tracking'
import { activeFetches, gitInstances } from './state'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

const INVALID_REPO_PATH = 'invalid repository path'

export function openRepoRejected(message: string = INVALID_REPO_PATH): OpenRepoResponse {
  return parseOrThrow(OpenRepoResponseSchema, { _tag: 'GitError', message })
}

export const invalidRepoPath = {
  branches: () =>
    parseOrThrow(BranchesResponseSchema, { _tag: 'GitError', message: INVALID_REPO_PATH }),
  checkout: () =>
    parseOrThrow(CheckoutResponseSchema, { _tag: 'GitError', message: INVALID_REPO_PATH }),
  commit: () =>
    parseOrThrow(CommitResponseSchema, { _tag: 'GitError', message: INVALID_REPO_PATH }),
  fetch: () => parseOrThrow(FetchResponseSchema, { _tag: 'GitError', message: INVALID_REPO_PATH }),
  log: () => parseOrThrow(LogResponseSchema, { _tag: 'GitError', message: INVALID_REPO_PATH }),
  stage: () => parseOrThrow(StageResponseSchema, { _tag: 'GitError', message: INVALID_REPO_PATH }),
  status: () =>
    parseOrThrow(StatusResponseSchema, { _tag: 'GitError', message: INVALID_REPO_PATH }),
  unstage: () =>
    parseOrThrow(UnstageResponseSchema, { _tag: 'GitError', message: INVALID_REPO_PATH })
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

export async function getBranches(repoPath: string): Promise<BranchesResponse> {
  const git = lookupGit(gitInstances, repoPath)
  if (!git) {
    return parseOrThrow(BranchesResponseSchema, { _tag: 'RepoNotOpen' })
  }
  try {
    const [branches, tags, trackingRaw] = await Promise.all([
      git.branch(['-a']),
      git.tags(),
      git.raw(['for-each-ref', 'refs/heads', '--format=%(refname:short)|%(upstream:track)'])
    ])
    const tracking = parseAheadBehind(trackingRaw)
    return parseOrThrow(BranchesResponseSchema, {
      _tag: 'Ok',
      branches: serializeBranches(branches, tags, tracking)
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
  try {
    await git.add(file)
    return parseOrThrow(StageResponseSchema, { _tag: 'Ok' })
  } catch (error) {
    return parseOrThrow(StageResponseSchema, { _tag: 'GitError', message: errorMessage(error) })
  }
}

export async function unstageFile(repoPath: string, file: string): Promise<UnstageResponse> {
  const git = lookupGit(gitInstances, repoPath)
  if (!git) {
    return parseOrThrow(UnstageResponseSchema, { _tag: 'RepoNotOpen' })
  }
  try {
    await git.reset(['HEAD', file])
    return parseOrThrow(UnstageResponseSchema, { _tag: 'Ok' })
  } catch (error) {
    return parseOrThrow(UnstageResponseSchema, { _tag: 'GitError', message: errorMessage(error) })
  }
}

export async function commit(repoPath: string, message: string): Promise<CommitResponse> {
  const git = lookupGit(gitInstances, repoPath)
  if (!git) {
    return parseOrThrow(CommitResponseSchema, { _tag: 'RepoNotOpen' })
  }
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
}

export async function getLog(repoPath: string, maxCount?: number): Promise<LogResponse> {
  const git = lookupGit(gitInstances, repoPath)
  if (!git) {
    return parseOrThrow(LogResponseSchema, { _tag: 'RepoNotOpen' })
  }
  try {
    const logOptions: Record<string, unknown> = { format: GRAPH_LOG_FORMAT, ...GRAPH_LOG_FLAGS }
    if (typeof maxCount === 'number' && maxCount > 0) {
      logOptions.maxCount = maxCount
    }
    const log = await git.log(logOptions)
    return parseOrThrow(LogResponseSchema, { _tag: 'Ok', log: serializeLog(log) })
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
  try {
    let checkedOut: string
    if (refKind === 'remote') {
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
    return parseOrThrow(CheckoutResponseSchema, { _tag: 'GitError', message: errorMessage(error) })
  }
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
  const semaphore = fetchSemaphoreFor(key)
  const result = await semaphore.withPermitsIfAvailable(() => runFetch(key))
  if (result === null) {
    return parseOrThrow(FetchResponseSchema, { _tag: 'FetchSkipped' })
  }
  return result
}
