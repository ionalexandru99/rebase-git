import type { FileDiff, GitStatus } from '@shared/schemas/git'
import { Effect, Either } from 'effect'
import { buildHunkPatch, parseUnifiedDiff, toFileDiff } from '../git/diff'
import { GitError, HunkNotFound, type RepoNotOpen } from '../git/errors'
import { isValidPathArg, literalPathspec, literalPathspecs } from '../git/pathspec'
import { isSafeRefArg } from '../git/ref-args'
import { serializeStatus } from '../git/serialize'
import { runGit } from '../git/spawn'
import { withRepoLock } from '../session/lock'
import type { RepoSessions } from '../session/sessions'
import { requireGit, requireOpen, tryGit } from './helpers'

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
      tryGit(() => git.raw(['add', '--', literalPathspec(file)]))
    )
  })
}

export function unstageFile(
  repoPath: string,
  file: string,
  renameSource?: string
): Effect.Effect<void, RepoNotOpen | GitError, RepoSessions> {
  return Effect.gen(function* () {
    const git = yield* requireGit(repoPath)
    const files = renameSource ? [renameSource, file] : [file]
    yield* withRepoLock(
      repoPath,
      tryGit(() => git.reset(['HEAD', '--', ...literalPathspecs(files)]))
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
      tryGit(() => git.raw(['add', '--', ...literalPathspecs(files)]))
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
      tryGit(() => git.reset(['HEAD', '--', ...literalPathspecs(files)]))
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
  args.push('--', literalPathspec(file))
  return runGit(args)
}

async function isUntracked(repoPath: string, file: string): Promise<boolean> {
  const out = await runGit([
    '-C',
    repoPath,
    'status',
    '--porcelain',
    '-z',
    '--',
    literalPathspec(file)
  ])
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

async function readConflictDiff(repoPath: string, file: string): Promise<string> {
  return runGit(['-C', repoPath, 'diff', ...DIFF_BASE_ARGS, '--ours', '--', literalPathspec(file)])
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
    if (!raw && !staged && range === undefined) {
      const untracked = yield* tryGit(() => isUntracked(repoPath, file))
      if (untracked) {
        raw = yield* tryGit(() => readUntrackedDiff(repoPath, file))
      }
    }
    let parsed = parseUnifiedDiff(raw)
    if (parsed.hunks.length === 0 && raw.includes('@@@') && !staged && range === undefined) {
      raw = yield* tryGit(() => readConflictDiff(repoPath, file))
      parsed = parseUnifiedDiff(raw)
    }
    return { diff: toFileDiff(file, parsed) }
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

export function discardChanges(
  repoPath: string,
  files: string[]
): Effect.Effect<void, RepoNotOpen | GitError, RepoSessions> {
  return Effect.gen(function* () {
    const git = yield* requireGit(repoPath)
    if (files.length === 0) {
      return
    }
    if (files.some((file) => !isValidPathArg(file))) {
      return yield* Effect.fail(new GitError({ message: 'invalid file path' }))
    }
    yield* withRepoLock(
      repoPath,
      Effect.gen(function* () {
        const statusRaw = yield* tryGit(() =>
          git.raw(['status', '--porcelain', '-z', '--', ...literalPathspecs(files)])
        )
        const untracked = new Set<string>()
        for (const entry of statusRaw.split('\0')) {
          if (entry.startsWith('??')) {
            untracked.add(entry.slice(3))
          }
        }
        const tracked = files.filter((file) => !untracked.has(file))
        if (tracked.length > 0) {
          const headCheck = yield* Effect.either(
            tryGit(() => git.raw(['rev-parse', '--verify', '--quiet', 'HEAD']))
          )
          const headExists = Either.isRight(headCheck) && headCheck.right.trim().length > 0
          if (headExists) {
            yield* tryGit(() =>
              git.raw([
                'restore',
                '--source=HEAD',
                '--staged',
                '--worktree',
                '--',
                ...literalPathspecs(tracked)
              ])
            )
          } else {
            yield* tryGit(() => git.raw(['rm', '-rf', '--', ...literalPathspecs(tracked)]))
          }
        }
        if (untracked.size > 0) {
          yield* tryGit(() => git.raw(['clean', '-fd', '--', ...literalPathspecs([...untracked])]))
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
        const headCheck = yield* Effect.either(
          tryGit(() => git.raw(['rev-parse', '--verify', '--quiet', 'HEAD']))
        )
        const headExists = Either.isRight(headCheck) && headCheck.right.trim().length > 0
        if (headExists) {
          yield* tryGit(() => git.raw(['reset', '--hard', 'HEAD']))
        } else {
          yield* tryGit(() => git.raw(['rm', '-rf', '--cached', '--ignore-unmatch', '--', '.']))
        }
        yield* tryGit(() => git.raw(['clean', '-fd']))
      })
    )
  })
}
