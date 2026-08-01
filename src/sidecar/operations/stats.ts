import { lstat, open } from 'node:fs/promises'
import path from 'node:path'
import { MAX_COMMIT_STATS_BATCH } from '@shared/git-constants'
import type { CommitStats, WorkingTreeStats } from '@shared/schemas/git'
import { Effect } from 'effect'
import { GitError, type RepoNotOpen } from '../git/errors'
import { normalizeRepoPath } from '../git/instances'
import { isSafeRefArg } from '../git/ref-args'
import { type RunGitOptions, startGit } from '../git/spawn'
import { type RepoSessions, withSessionScope } from '../session/sessions'
import { requireOpen, tryGit } from './helpers'

const RECORD_SEPARATOR = '\x00'
const RECORD_SEPARATOR_FORMAT = '%x00'

const BATCH_ARGS = [
  'log',
  '--no-walk=unsorted',
  '--numstat',
  '--root',
  '--ignore-missing',
  '--diff-merges=first-parent',
  `--format=${RECORD_SEPARATOR_FORMAT}%H`,
  '--stdin'
]

function sumNumstat(lines: string[]): WorkingTreeStats {
  let additions = 0
  let deletions = 0
  for (const line of lines) {
    const [added, removed] = line.split('\t')
    if (added === undefined || removed === undefined) {
      continue
    }
    additions += Number.parseInt(added, 10) || 0
    deletions += Number.parseInt(removed, 10) || 0
  }
  return { additions, deletions }
}

const BINARY_SNIFF_BYTES = 8_000
const FILE_READ_BUFFER_BYTES = 64 * 1_024

function runSessionGit(args: string[], options?: RunGitOptions) {
  return Effect.gen(function* () {
    const running = yield* Effect.acquireRelease(
      Effect.sync(() => startGit(args, options)),
      (process) => Effect.promise(() => process.terminate()).pipe(Effect.orDie)
    )
    const result = yield* tryGit(() => running.result)
    const okExitCodes = options?.okExitCodes ?? [0]
    if (result.code !== null && okExitCodes.includes(result.code)) {
      return result.stdout
    }
    return yield* Effect.fail(
      new GitError({ message: result.stderr.trim() || `git exited with code ${result.code}` })
    )
  })
}

function countTextFileLines(filePath: string) {
  return Effect.gen(function* () {
    const file = yield* Effect.acquireRelease(
      tryGit(() => open(filePath, 'r')),
      (handle) => Effect.promise(() => handle.close()).pipe(Effect.orDie)
    )
    const buffer = Buffer.allocUnsafe(FILE_READ_BUFFER_BYTES)
    let totalBytes = 0
    let lineFeeds = 0
    let lastByte = -1
    let binary = false
    while (true) {
      const { bytesRead } = yield* tryGit(() => file.read(buffer, 0, buffer.length, null))
      if (bytesRead === 0) {
        break
      }
      const sniffBytes = Math.min(bytesRead, Math.max(0, BINARY_SNIFF_BYTES - totalBytes))
      for (let index = 0; index < sniffBytes; index += 1) {
        if (buffer[index] === 0) {
          binary = true
          break
        }
      }
      if (binary) {
        break
      }
      for (let index = 0; index < bytesRead; index += 1) {
        if (buffer[index] === 10) {
          lineFeeds += 1
        }
      }
      totalBytes += bytesRead
      lastByte = buffer[bytesRead - 1]
    }
    if (binary || totalBytes === 0) {
      return 0
    }
    return lineFeeds + (lastByte === 10 ? 0 : 1)
  })
}

function countWorktreeFileLines(repoPath: string, relativePaths: readonly string[]) {
  return Effect.gen(function* () {
    let additions = 0
    for (const relativePath of new Set(relativePaths)) {
      const filePath = path.join(repoPath, relativePath)
      const stats = yield* tryGit(() =>
        lstat(filePath).catch((error: unknown) => {
          if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
            return null
          }
          throw error
        })
      )
      if (stats === null) {
        continue
      }
      if (stats.isSymbolicLink()) {
        additions += 1
      } else if (stats.isFile()) {
        additions += yield* countTextFileLines(filePath)
      }
    }
    return additions
  })
}

function parseCommitStats(output: string): CommitStats {
  const stats: CommitStats = []
  for (const record of output.split(RECORD_SEPARATOR)) {
    const lines = record.split('\n')
    const sha = lines[0]?.trim()
    if (!sha) {
      continue
    }
    stats.push({ sha, ...sumNumstat(lines.slice(1)) })
  }
  return stats
}

export function getCommitStats(
  repoPath: string,
  shas: readonly string[]
): Effect.Effect<{ stats: CommitStats }, RepoNotOpen | GitError, RepoSessions> {
  const key = normalizeRepoPath(repoPath)
  return Effect.gen(function* () {
    yield* requireOpen(key)
    if (shas.length > MAX_COMMIT_STATS_BATCH) {
      return yield* Effect.fail(
        new GitError({ message: `too many commits: ${shas.length} > ${MAX_COMMIT_STATS_BATCH}` })
      )
    }
    const unsafe = shas.find((sha) => !isSafeRefArg(sha))
    if (unsafe !== undefined) {
      return yield* Effect.fail(new GitError({ message: `unsafe commit: ${unsafe}` }))
    }
    if (shas.length === 0) {
      return { stats: [] }
    }
    return yield* withSessionScope(
      key,
      Effect.gen(function* () {
        const output = yield* runSessionGit(['-C', key, ...BATCH_ARGS], {
          stdin: `${shas.join('\n')}\n`
        })
        return { stats: parseCommitStats(output) }
      })
    )
  })
}

export function getWorkingTreeStats(
  repoPath: string
): Effect.Effect<WorkingTreeStats, RepoNotOpen | GitError, RepoSessions> {
  const key = normalizeRepoPath(repoPath)
  return Effect.gen(function* () {
    yield* requireOpen(key)
    return yield* withSessionScope(
      key,
      Effect.gen(function* () {
        const head = yield* runSessionGit(['-C', key, 'rev-parse', '--verify', '--quiet', 'HEAD'], {
          okExitCodes: [0, 1]
        })
        const hasHead = head.trim().length > 0
        const trackedOutput = hasHead
          ? yield* runSessionGit(['-C', key, 'diff', '--numstat', 'HEAD', '--'])
          : ''
        const listedFiles = yield* runSessionGit([
          '-C',
          key,
          'ls-files',
          '-z',
          ...(hasHead ? [] : ['--cached']),
          '--others',
          '--exclude-standard',
          '--'
        ])
        const worktreeAdditions = yield* countWorktreeFileLines(
          key,
          listedFiles.split('\0').filter(Boolean)
        )
        const tracked = sumNumstat(trackedOutput.split('\n'))
        return { additions: tracked.additions + worktreeAdditions, deletions: tracked.deletions }
      })
    )
  })
}
