import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { encodeOrThrow } from '@shared/codec'
import {
  BranchesResponse,
  CheckoutResponse,
  CommitResponse,
  FetchResponse,
  LogResponse,
  OpenRepoResponse,
  ScanForReposResponse,
  StageResponse,
  StatusResponse,
  UnstageResponse
} from '@shared/schemas/ipc'
import { Effect, Option } from 'effect'
import { simpleGit } from 'simple-git'
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
import { activeFetches, fetchSemaphoreFor, gitInstances, releaseFetchSemaphore } from './state'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function openRepo(repoPath: string): Promise<typeof OpenRepoResponse.Encoded> {
  const key = normalizeRepoPath(repoPath)
  try {
    const git = getOrCreateGit(gitInstances, key)
    const isRepo = await git.checkIsRepo()
    if (!isRepo) {
      gitInstances.delete(key)
      return encodeOrThrow(OpenRepoResponse, { _tag: 'NotARepo' })
    }
    const remotes = await git.getRemotes(true)
    const defaultBranch = await resolveDefaultBranch(git, undefined)
    return encodeOrThrow(OpenRepoResponse, {
      _tag: 'Ok',
      result: { remotes: serializeRemotes(remotes), defaultBranch, path: key }
    })
  } catch (error) {
    return encodeOrThrow(OpenRepoResponse, { _tag: 'GitError', message: errorMessage(error) })
  }
}

export async function closeRepo(repoPath: string): Promise<Record<string, never>> {
  const key = normalizeRepoPath(repoPath)
  gitInstances.delete(key)
  const proc = activeFetches.get(key)
  if (proc && !proc.killed) proc.kill()
  activeFetches.delete(key)
  releaseFetchSemaphore(key)
  return {}
}

export async function getBranches(repoPath: string): Promise<typeof BranchesResponse.Encoded> {
  const git = lookupGit(gitInstances, repoPath)
  if (!git) return encodeOrThrow(BranchesResponse, { _tag: 'RepoNotOpen' })
  try {
    const [branches, tags, trackingRaw] = await Promise.all([
      git.branch(['-a']),
      git.tags(),
      git.raw(['for-each-ref', 'refs/heads', '--format=%(refname:short)|%(upstream:track)'])
    ])
    const tracking = parseAheadBehind(trackingRaw)
    return encodeOrThrow(BranchesResponse, {
      _tag: 'Ok',
      branches: serializeBranches(branches, tags, tracking)
    })
  } catch (error) {
    return encodeOrThrow(BranchesResponse, { _tag: 'GitError', message: errorMessage(error) })
  }
}

export async function getStatus(repoPath: string): Promise<typeof StatusResponse.Encoded> {
  const git = lookupGit(gitInstances, repoPath)
  if (!git) return encodeOrThrow(StatusResponse, { _tag: 'RepoNotOpen' })
  try {
    const status = await git.status()
    return encodeOrThrow(StatusResponse, { _tag: 'Ok', status: serializeStatus(status) })
  } catch (error) {
    return encodeOrThrow(StatusResponse, { _tag: 'GitError', message: errorMessage(error) })
  }
}

export async function stageFile(
  repoPath: string,
  file: string
): Promise<typeof StageResponse.Encoded> {
  const git = lookupGit(gitInstances, repoPath)
  if (!git) return encodeOrThrow(StageResponse, { _tag: 'RepoNotOpen' })
  try {
    await git.add(file)
    return encodeOrThrow(StageResponse, { _tag: 'Ok' })
  } catch (error) {
    return encodeOrThrow(StageResponse, { _tag: 'GitError', message: errorMessage(error) })
  }
}

export async function unstageFile(
  repoPath: string,
  file: string
): Promise<typeof UnstageResponse.Encoded> {
  const git = lookupGit(gitInstances, repoPath)
  if (!git) return encodeOrThrow(UnstageResponse, { _tag: 'RepoNotOpen' })
  try {
    await git.reset(['HEAD', file])
    return encodeOrThrow(UnstageResponse, { _tag: 'Ok' })
  } catch (error) {
    return encodeOrThrow(UnstageResponse, { _tag: 'GitError', message: errorMessage(error) })
  }
}

export async function commit(
  repoPath: string,
  message: string
): Promise<typeof CommitResponse.Encoded> {
  const git = lookupGit(gitInstances, repoPath)
  if (!git) return encodeOrThrow(CommitResponse, { _tag: 'RepoNotOpen' })
  try {
    const result = await git.commit(message)
    return encodeOrThrow(CommitResponse, {
      _tag: 'Ok',
      result: {
        commit: result.commit,
        branch: result.branch,
        summary: { ...result.summary }
      }
    })
  } catch (error) {
    return encodeOrThrow(CommitResponse, { _tag: 'GitError', message: errorMessage(error) })
  }
}

export async function getLog(
  repoPath: string,
  maxCount?: number
): Promise<typeof LogResponse.Encoded> {
  const git = lookupGit(gitInstances, repoPath)
  if (!git) return encodeOrThrow(LogResponse, { _tag: 'RepoNotOpen' })
  try {
    const logOptions: Record<string, unknown> = { format: GRAPH_LOG_FORMAT, ...GRAPH_LOG_FLAGS }
    if (typeof maxCount === 'number' && maxCount > 0) logOptions.maxCount = maxCount
    const log = await git.log(logOptions)
    return encodeOrThrow(LogResponse, { _tag: 'Ok', log: serializeLog(log) })
  } catch (error) {
    return encodeOrThrow(LogResponse, { _tag: 'GitError', message: errorMessage(error) })
  }
}

export async function checkoutRef(
  repoPath: string,
  refKind: 'local' | 'remote' | 'tag',
  fullPath: string
): Promise<typeof CheckoutResponse.Encoded> {
  const git = lookupGit(gitInstances, repoPath)
  if (!git) return encodeOrThrow(CheckoutResponse, { _tag: 'RepoNotOpen' })
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
          return encodeOrThrow(CheckoutResponse, {
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
    return encodeOrThrow(CheckoutResponse, { _tag: 'Ok', checkedOut })
  } catch (error) {
    return encodeOrThrow(CheckoutResponse, { _tag: 'GitError', message: errorMessage(error) })
  }
}

function runFetch(key: string): Effect.Effect<typeof FetchResponse.Encoded> {
  return Effect.async<typeof FetchResponse.Encoded>((resume) => {
    const proc = spawn('git', ['-C', key, 'fetch', '--prune'], {
      stdio: ['ignore', 'ignore', 'pipe'],
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
    })
    activeFetches.set(key, proc)

    let stderrBuf = ''
    proc.stderr?.setEncoding('utf8')
    proc.stderr?.on('data', (chunk: string) => {
      stderrBuf += chunk
      if (stderrBuf.length > 4096) stderrBuf = stderrBuf.slice(-4096)
    })

    proc.on('error', (err) => {
      if (activeFetches.get(key) === proc) activeFetches.delete(key)
      resume(
        Effect.succeed(encodeOrThrow(FetchResponse, { _tag: 'GitError', message: err.message }))
      )
    })

    proc.on('close', (code) => {
      if (activeFetches.get(key) === proc) activeFetches.delete(key)
      if (code === 0) {
        resume(Effect.succeed(encodeOrThrow(FetchResponse, { _tag: 'Ok' })))
      } else {
        resume(
          Effect.succeed(
            encodeOrThrow(FetchResponse, {
              _tag: 'GitError',
              message: stderrBuf.trim() || `git fetch exited with code ${code}`
            })
          )
        )
      }
    })
  })
}

export async function fetchRepo(repoPath: string): Promise<typeof FetchResponse.Encoded> {
  const key = normalizeRepoPath(repoPath)
  if (!gitInstances.has(key)) {
    return encodeOrThrow(FetchResponse, { _tag: 'RepoNotOpen' })
  }
  const semaphore = fetchSemaphoreFor(key)
  const result = await Effect.runPromise(semaphore.withPermitsIfAvailable(1)(runFetch(key)))
  if (Option.isNone(result)) {
    return encodeOrThrow(FetchResponse, { _tag: 'FetchSkipped' })
  }
  return result.value
}

export async function scanForRepos(
  scanRoot: string | null
): Promise<typeof ScanForReposResponse.Encoded> {
  if (!scanRoot) {
    return encodeOrThrow(ScanForReposResponse, {
      _tag: 'GitError',
      message: 'invalid directory path'
    })
  }
  try {
    const entries = await fs.promises.readdir(scanRoot, { withFileTypes: true })
    const repos: string[] = []
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const fullPath = path.join(scanRoot, entry.name)
        try {
          const git = simpleGit(fullPath)
          const isRepo = await git.checkIsRepo()
          if (isRepo) repos.push(fullPath)
        } catch {}
      }
    }
    return encodeOrThrow(ScanForReposResponse, { _tag: 'Ok', repos })
  } catch (error) {
    return encodeOrThrow(ScanForReposResponse, { _tag: 'GitError', message: errorMessage(error) })
  }
}
