import { lstat, open } from 'node:fs/promises'
import path from 'node:path'
import { MAX_COMMIT_STATS_BATCH } from '@shared/git-constants'
import type { CommitStats, WorkingTreeStats } from '@shared/schemas/git'
import { Effect } from 'effect'
import { GitError, type RepoNotOpen } from '../git/errors'
import { normalizeRepoPath } from '../git/instances'
import { isSafeRefArg } from '../git/ref-args'
import { runGit } from '../git/spawn'
import type { RepoSessions } from '../session/sessions'
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

async function countTextFileLines(filePath: string): Promise<number> {
  const file = await open(filePath, 'r')
  const buffer = Buffer.allocUnsafe(FILE_READ_BUFFER_BYTES)
  let totalBytes = 0
  let lineFeeds = 0
  let lastByte = -1
  let binary = false
  try {
    while (true) {
      const { bytesRead } = await file.read(buffer, 0, buffer.length, null)
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
  } finally {
    await file.close()
  }
  if (binary || totalBytes === 0) {
    return 0
  }
  return lineFeeds + (lastByte === 10 ? 0 : 1)
}

async function countWorktreeFileLines(repoPath: string, relativePaths: readonly string[]) {
  let additions = 0
  for (const relativePath of new Set(relativePaths)) {
    const filePath = path.join(repoPath, relativePath)
    const stats = await lstat(filePath).catch((error: unknown) => {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return null
      }
      throw error
    })
    if (stats === null) {
      continue
    }
    if (stats.isSymbolicLink()) {
      additions += 1
    } else if (stats.isFile()) {
      additions += await countTextFileLines(filePath)
    }
  }
  return additions
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
  return Effect.gen(function* () {
    const key = normalizeRepoPath(repoPath)
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
    const output = yield* tryGit(() =>
      runGit(['-C', key, ...BATCH_ARGS], { stdin: `${shas.join('\n')}\n` })
    )
    return { stats: parseCommitStats(output) }
  })
}

export function getWorkingTreeStats(
  repoPath: string
): Effect.Effect<WorkingTreeStats, RepoNotOpen | GitError, RepoSessions> {
  return Effect.gen(function* () {
    const key = normalizeRepoPath(repoPath)
    yield* requireOpen(key)
    const head = yield* tryGit(() =>
      runGit(['-C', key, 'rev-parse', '--verify', '--quiet', 'HEAD'], { okExitCodes: [0, 1] })
    )
    const hasHead = head.trim().length > 0
    const trackedOutput = hasHead
      ? yield* tryGit(() => runGit(['-C', key, 'diff', '--numstat', 'HEAD', '--']))
      : ''
    const listedFiles = yield* tryGit(() =>
      runGit([
        '-C',
        key,
        'ls-files',
        '-z',
        ...(hasHead ? [] : ['--cached']),
        '--others',
        '--exclude-standard',
        '--'
      ])
    )
    const worktreeAdditions = yield* tryGit(() =>
      countWorktreeFileLines(key, listedFiles.split('\0').filter(Boolean))
    )
    const tracked = sumNumstat(trackedOutput.split('\n'))
    return { additions: tracked.additions + worktreeAdditions, deletions: tracked.deletions }
  })
}
