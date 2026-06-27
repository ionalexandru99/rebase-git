import type { StashEntry } from '@shared/schemas/ipc'
import { Effect } from 'effect'
import { runWithConflictDetection } from './conflict'
import { type Conflict, GitError, type RepoNotOpen } from './git-errors'
import { requireGit, tryGit } from './op-helpers'
import { isSafeRefArg } from './ref-args'
import { withRepoLock } from './repo-lock'
import type { RepoSessions } from './repo-sessions'

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

export function stashList(
  repoPath: string
): Effect.Effect<{ stashes: StashEntry[] }, RepoNotOpen | GitError, RepoSessions> {
  return Effect.gen(function* () {
    const git = yield* requireGit(repoPath)
    const raw = yield* tryGit(() => git.raw(['stash', 'list', `--format=%gd${STASH_FIELD_SEP}%gs`]))
    return { stashes: parseStashList(raw) }
  })
}

export function stashPush(
  repoPath: string,
  message?: string,
  includeUntracked?: boolean,
  files?: string[]
): Effect.Effect<void, RepoNotOpen | GitError, RepoSessions> {
  return Effect.gen(function* () {
    const git = yield* requireGit(repoPath)
    if (files?.some((file) => !isSafeRefArg(file))) {
      return yield* Effect.fail(new GitError({ message: 'invalid file path' }))
    }
    yield* withRepoLock(
      repoPath,
      tryGit(() => {
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
        return git.raw(args)
      })
    )
  })
}

function stashRef(index: number): string | null {
  return Number.isInteger(index) && index >= 0 ? `stash@{${index}}` : null
}

export function stashApply(
  repoPath: string,
  index: number
): Effect.Effect<void, RepoNotOpen | GitError | Conflict, RepoSessions> {
  return Effect.gen(function* () {
    const git = yield* requireGit(repoPath)
    const ref = stashRef(index)
    if (!ref) {
      return yield* Effect.fail(new GitError({ message: 'invalid stash index' }))
    }
    yield* runWithConflictDetection(repoPath, git, ['stash', 'apply', ref])
  })
}

export function stashPop(
  repoPath: string,
  index: number
): Effect.Effect<void, RepoNotOpen | GitError | Conflict, RepoSessions> {
  return Effect.gen(function* () {
    const git = yield* requireGit(repoPath)
    const ref = stashRef(index)
    if (!ref) {
      return yield* Effect.fail(new GitError({ message: 'invalid stash index' }))
    }
    yield* runWithConflictDetection(repoPath, git, ['stash', 'pop', ref])
  })
}

export function stashDrop(
  repoPath: string,
  index: number
): Effect.Effect<void, RepoNotOpen | GitError, RepoSessions> {
  return Effect.gen(function* () {
    const git = yield* requireGit(repoPath)
    const ref = stashRef(index)
    if (!ref) {
      return yield* Effect.fail(new GitError({ message: 'invalid stash index' }))
    }
    yield* withRepoLock(
      repoPath,
      tryGit(() => git.raw(['stash', 'drop', ref]))
    )
  })
}
