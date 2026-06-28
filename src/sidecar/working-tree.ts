import type { FileDiff, GitStatus } from '@shared/schemas/git'
import { Effect } from 'effect'
import { buildHunkPatch, parseUnifiedDiff, toFileDiff } from './git/diff'
import { serializeStatus } from './git/serialize'
import { GitError, HunkNotFound, type RepoNotOpen } from './git-errors'
import { requireGit, requireOpen, tryGit } from './op-helpers'
import { isSafeRefArg } from './ref-args'
import { withRepoLock } from './repo-lock'
import type { RepoSessions } from './repo-sessions'
import { runGit } from './spawn'

export function getStatus(
  repoPath: string
): Effect.Effect<{ status: GitStatus }, RepoNotOpen | GitError, RepoSessions> {
  return Effect.gen(function* () {
    const git = yield* requireGit(repoPath)
    const status = yield* tryGit(() => git.status())
    return { status: serializeStatus(status) }
  })
}

export function stageFile(
  repoPath: string,
  file: string
): Effect.Effect<void, RepoNotOpen | GitError, RepoSessions> {
  return Effect.gen(function* () {
    const git = yield* requireGit(repoPath)
    yield* withRepoLock(
      repoPath,
      tryGit(() => git.add(file))
    )
  })
}

export function unstageFile(
  repoPath: string,
  file: string
): Effect.Effect<void, RepoNotOpen | GitError, RepoSessions> {
  return Effect.gen(function* () {
    const git = yield* requireGit(repoPath)
    yield* withRepoLock(
      repoPath,
      tryGit(() => git.reset(['HEAD', '--', file]))
    )
  })
}

export function stageAll(
  repoPath: string,
  files: string[]
): Effect.Effect<void, RepoNotOpen | GitError, RepoSessions> {
  return Effect.gen(function* () {
    const git = yield* requireGit(repoPath)
    if (files.length === 0) {
      return
    }
    yield* withRepoLock(
      repoPath,
      tryGit(() => git.add(files))
    )
  })
}

export function unstageAll(
  repoPath: string,
  files: string[]
): Effect.Effect<void, RepoNotOpen | GitError, RepoSessions> {
  return Effect.gen(function* () {
    const git = yield* requireGit(repoPath)
    if (files.length === 0) {
      return
    }
    yield* withRepoLock(
      repoPath,
      tryGit(() => git.reset(['HEAD', '--', ...files]))
    )
  })
}

const DIFF_BASE_ARGS = ['--no-color', '--no-ext-diff', '--unified=3']

async function readFileDiff(
  repoPath: string,
  file: string,
  staged: boolean,
  range?: string
): Promise<string> {
  const args = ['-C', repoPath, 'diff', ...DIFF_BASE_ARGS]
  if (range !== undefined) {
    args.push(range)
  } else if (staged) {
    args.push('--cached')
  }
  args.push('--', file)
  return runGit(args)
}

async function isUntracked(repoPath: string, file: string): Promise<boolean> {
  const out = await runGit(['-C', repoPath, 'status', '--porcelain', '-z', '--', file])
  return out.startsWith('??')
}

async function readUntrackedDiff(repoPath: string, file: string): Promise<string> {
  return runGit(
    ['-C', repoPath, 'diff', ...DIFF_BASE_ARGS, '--no-index', '--', '/dev/null', file],
    {
      okExitCodes: [0, 1]
    }
  )
}

export function getDiff(
  repoPath: string,
  file: string,
  staged: boolean,
  range?: string
): Effect.Effect<{ diff: FileDiff }, RepoNotOpen | GitError, RepoSessions> {
  return Effect.gen(function* () {
    yield* requireOpen(repoPath)
    if (range !== undefined && !isSafeRefArg(range)) {
      return yield* Effect.fail(new GitError({ message: `unsafe diff range: ${range}` }))
    }
    let raw = yield* tryGit(() => readFileDiff(repoPath, file, staged, range))
    // The untracked fallback only makes sense for the working tree; a range diff is always tracked.
    if (!raw && !staged && range === undefined) {
      const untracked = yield* tryGit(() => isUntracked(repoPath, file))
      if (untracked) {
        raw = yield* tryGit(() => readUntrackedDiff(repoPath, file))
      }
    }
    return { diff: toFileDiff(file, parseUnifiedDiff(raw)) }
  })
}

function applyHunk(
  repoPath: string,
  file: string,
  hunkHeader: string,
  direction: 'stage' | 'unstage'
): Effect.Effect<void, RepoNotOpen | GitError | HunkNotFound, RepoSessions> {
  return Effect.gen(function* () {
    yield* requireOpen(repoPath)
    yield* withRepoLock(
      repoPath,
      Effect.gen(function* () {
        const raw = yield* tryGit(() => readFileDiff(repoPath, file, direction === 'unstage'))
        const patch = buildHunkPatch(parseUnifiedDiff(raw), hunkHeader)
        if (!patch) {
          return yield* Effect.fail(new HunkNotFound())
        }
        const applyArgs = ['-C', repoPath, 'apply', '--cached', '--whitespace=nowarn']
        if (direction === 'unstage') {
          applyArgs.push('-R')
        }
        applyArgs.push('-')
        yield* tryGit(() => runGit(applyArgs, { stdin: patch }))
      })
    )
  })
}

export function stageHunk(
  repoPath: string,
  file: string,
  hunkHeader: string
): Effect.Effect<void, RepoNotOpen | GitError | HunkNotFound, RepoSessions> {
  return applyHunk(repoPath, file, hunkHeader, 'stage')
}

export function unstageHunk(
  repoPath: string,
  file: string,
  hunkHeader: string
): Effect.Effect<void, RepoNotOpen | GitError | HunkNotFound, RepoSessions> {
  return applyHunk(repoPath, file, hunkHeader, 'unstage')
}

// Discard local edits to the given paths: untracked paths are deleted, tracked paths are restored
// to their committed/index baseline. The two cases need different git verbs, so classify first.
export function discardChanges(
  repoPath: string,
  files: string[]
): Effect.Effect<void, RepoNotOpen | GitError, RepoSessions> {
  return Effect.gen(function* () {
    const git = yield* requireGit(repoPath)
    if (files.length === 0) {
      return
    }
    if (files.some((file) => !isSafeRefArg(file))) {
      return yield* Effect.fail(new GitError({ message: 'invalid file path' }))
    }
    yield* withRepoLock(
      repoPath,
      Effect.gen(function* () {
        const statusRaw = yield* tryGit(() =>
          git.raw(['status', '--porcelain', '-z', '--', ...files])
        )
        const untracked = new Set<string>()
        for (const entry of statusRaw.split('\0')) {
          if (entry.startsWith('??')) {
            untracked.add(entry.slice(3))
          }
        }
        const tracked = files.filter((file) => !untracked.has(file))
        if (tracked.length > 0) {
          yield* tryGit(() => git.raw(['restore', '--', ...tracked]))
        }
        if (untracked.size > 0) {
          yield* tryGit(() => git.raw(['clean', '-fd', '--', ...untracked]))
        }
      })
    )
  })
}

export function discardAll(
  repoPath: string
): Effect.Effect<void, RepoNotOpen | GitError, RepoSessions> {
  return Effect.gen(function* () {
    const git = yield* requireGit(repoPath)
    yield* withRepoLock(
      repoPath,
      Effect.gen(function* () {
        yield* tryGit(() => git.raw(['reset', '--hard', 'HEAD']))
        yield* tryGit(() => git.raw(['clean', '-fd']))
      })
    )
  })
}
