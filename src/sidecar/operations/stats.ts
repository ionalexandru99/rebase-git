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
    if (head.trim().length === 0) {
      return { additions: 0, deletions: 0 }
    }
    const output = yield* tryGit(() => runGit(['-C', key, 'diff', '--numstat', 'HEAD', '--']))
    return sumNumstat(output.split('\n'))
  })
}
