import type { HunkLineSelection } from '@shared/rpc'
import type { GitStatus } from '@shared/schemas/git'
import { Effect, Either } from 'effect'
import {
  buildHunkPatch,
  buildSelectedLinesPatch,
  type ParsedFileDiff,
  parseUnifiedDiff
} from '../git/diff'
import { GitError, HunkNotFound, type OperationInProgress, type RepoNotOpen } from '../git/errors'
import { isValidPathArg, literalPathspec, literalPathspecs } from '../git/pathspec'
import { isSafeRefArg } from '../git/ref-args'
import { serializeStatus } from '../git/serialize'
import { runGit } from '../git/spawn'
import { withRepoLock } from '../session/lock'
import type { RepoSessions } from '../session/sessions'
import { unmergedPaths } from './conflict-resolution'
import {
  classifyDiscardPaths,
  discardAllArgs,
  trackedDiscardArgs,
  untrackedDiscardArgs
} from './discard-plan'
import { requireGit, requireOpen, tryGit } from './helpers'
import { requireNoOperationForPaths } from './in-progress'
import { detectOperationState } from './operation-state'

export function getStatus(
  repoPath: string
): Effect.Effect<{ status: GitStatus }, RepoNotOpen | GitError, RepoSessions> {
  return Effect.gen(function* () {
    const git = yield* requireGit(repoPath)
    const status = yield* tryGit(() => git.status())
    const operation = yield* tryGit(() => detectOperationState(repoPath))
    return { status: { ...serializeStatus(status), operation } }
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
): Effect.Effect<void, RepoNotOpen | GitError | OperationInProgress, RepoSessions> {
  return Effect.gen(function* () {
    const git = yield* requireGit(repoPath)
    const files = renameSource ? [renameSource, file] : [file]
    yield* withRepoLock(
      repoPath,
      Effect.gen(function* () {
        yield* requireNoOperationForPaths(repoPath, files)
        yield* tryGit(() => git.reset(['HEAD', '--', ...literalPathspecs(files)]))
      })
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
): Effect.Effect<void, RepoNotOpen | GitError | OperationInProgress, RepoSessions> {
  return Effect.gen(function* () {
    const git = yield* requireGit(repoPath)
    if (files.length === 0) {
      return
    }
    yield* withRepoLock(
      repoPath,
      Effect.gen(function* () {
        yield* requireNoOperationForPaths(repoPath, files)
        yield* tryGit(() => git.reset(['HEAD', '--', ...literalPathspecs(files)]))
      })
    )
  })
}

const DIFF_BASE_ARGS = ['--no-color', '--no-ext-diff', '--unified=3']

export interface DiffScope {
  range?: string
  commit?: string
  renameSource?: string
}

async function readFileDiff(
  repoPath: string,
  file: string,
  staged: boolean,
  scope?: DiffScope
): Promise<string> {
  const pathspecs = scope?.renameSource
    ? literalPathspecs([scope.renameSource, file])
    : [literalPathspec(file)]
  if (scope?.commit !== undefined) {
    return runGit([
      '-C',
      repoPath,
      'show',
      ...DIFF_BASE_ARGS,
      '--format=',
      '-m',
      '--first-parent',
      '--find-renames',
      scope.commit,
      '--',
      ...pathspecs
    ])
  }
  const args = ['-C', repoPath, 'diff', ...DIFF_BASE_ARGS]
  if (scope?.range !== undefined) {
    args.push(scope.range)
  } else if (staged) {
    args.push('--cached')
  }
  args.push('--', ...pathspecs)
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

async function readDiff(
  repoPath: string,
  file: string,
  staged: boolean,
  scope?: DiffScope
): Promise<{ raw: string; parsed: ParsedFileDiff }> {
  const isWorkingTree = scope?.range === undefined && scope?.commit === undefined
  let raw = await readFileDiff(repoPath, file, staged, scope)
  if (!raw && !staged && isWorkingTree && (await isUntracked(repoPath, file))) {
    raw = await readUntrackedDiff(repoPath, file)
  }
  const parsed = parseUnifiedDiff(raw)
  if (parsed.hunks.length === 0 && raw.includes('@@@') && !staged && isWorkingTree) {
    const conflictRaw = await readConflictDiff(repoPath, file)
    return { raw: conflictRaw, parsed: parseUnifiedDiff(conflictRaw) }
  }
  return { raw, parsed }
}

export function getDiff(
  repoPath: string,
  file: string,
  staged: boolean,
  scope?: DiffScope
): Effect.Effect<{ patch: string; binary: boolean }, RepoNotOpen | GitError, RepoSessions> {
  return Effect.gen(function* () {
    yield* requireOpen(repoPath)
    if (scope?.range !== undefined && !isSafeRefArg(scope.range)) {
      return yield* Effect.fail(new GitError({ message: `unsafe diff range: ${scope.range}` }))
    }
    if (scope?.commit !== undefined && !isSafeRefArg(scope.commit)) {
      return yield* Effect.fail(new GitError({ message: `unsafe diff commit: ${scope.commit}` }))
    }
    const { raw, parsed } = yield* tryGit(() => readDiff(repoPath, file, staged, scope))
    return { patch: raw, binary: parsed.binary }
  })
}

function applyHunk<GuardError = never>(
  repoPath: string,
  file: string,
  hunkHeader: string,
  direction: 'stage' | 'unstage' | 'discard',
  guard?: Effect.Effect<void, GuardError>
): Effect.Effect<void, RepoNotOpen | GitError | HunkNotFound | GuardError, RepoSessions> {
  return Effect.gen(function* () {
    yield* requireOpen(repoPath)
    yield* withRepoLock(
      repoPath,
      Effect.gen(function* () {
        if (guard) {
          yield* guard
        }
        const { parsed } = yield* tryGit(() => readDiff(repoPath, file, direction === 'unstage'))
        const patch = buildHunkPatch(parsed, hunkHeader)
        if (!patch) {
          return yield* Effect.fail(new HunkNotFound())
        }
        const applyArgs = ['-C', repoPath, 'apply', '--whitespace=nowarn']
        if (direction !== 'discard') {
          applyArgs.push('--cached')
        }
        if (direction !== 'stage') {
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
): Effect.Effect<void, RepoNotOpen | GitError | HunkNotFound | OperationInProgress, RepoSessions> {
  return applyHunk(
    repoPath,
    file,
    hunkHeader,
    'unstage',
    requireNoOperationForPaths(repoPath, [file])
  )
}

export function discardHunk(
  repoPath: string,
  file: string,
  hunkHeader: string
): Effect.Effect<void, RepoNotOpen | GitError | HunkNotFound | OperationInProgress, RepoSessions> {
  return applyHunk(
    repoPath,
    file,
    hunkHeader,
    'discard',
    requireNoOperationForPaths(repoPath, [file])
  )
}

function applyLines<GuardError = never>(
  repoPath: string,
  file: string,
  selections: readonly HunkLineSelection[],
  direction: 'stage' | 'unstage',
  guard?: Effect.Effect<void, GuardError>
): Effect.Effect<void, RepoNotOpen | GitError | HunkNotFound | GuardError, RepoSessions> {
  return Effect.gen(function* () {
    yield* requireOpen(repoPath)
    yield* withRepoLock(
      repoPath,
      Effect.gen(function* () {
        if (guard) {
          yield* guard
        }
        const unmerged = yield* tryGit(() => unmergedPaths(repoPath))
        if (unmerged.includes(file)) {
          return yield* Effect.fail(
            new GitError({ message: `cannot ${direction} lines of conflicted file: ${file}` })
          )
        }
        const { parsed } = yield* tryGit(() => readDiff(repoPath, file, direction === 'unstage'))
        const patch = buildSelectedLinesPatch(parsed, selections, direction)
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

export function stageLines(
  repoPath: string,
  file: string,
  selections: readonly HunkLineSelection[]
): Effect.Effect<void, RepoNotOpen | GitError | HunkNotFound, RepoSessions> {
  return applyLines(repoPath, file, selections, 'stage')
}

export function unstageLines(
  repoPath: string,
  file: string,
  selections: readonly HunkLineSelection[]
): Effect.Effect<void, RepoNotOpen | GitError | HunkNotFound | OperationInProgress, RepoSessions> {
  return applyLines(
    repoPath,
    file,
    selections,
    'unstage',
    requireNoOperationForPaths(repoPath, [file])
  )
}

export function discardChanges(
  repoPath: string,
  files: string[]
): Effect.Effect<void, RepoNotOpen | GitError | OperationInProgress, RepoSessions> {
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
        yield* requireNoOperationForPaths(repoPath, files, {
          exempt: yield* tryGit(() => unmergedPaths(repoPath))
        })
        const statusRaw = yield* tryGit(() =>
          git.raw(['status', '--porcelain', '-z', '--', ...literalPathspecs(files)])
        )
        const { tracked, untracked } = classifyDiscardPaths(files, statusRaw)
        if (tracked.length > 0) {
          const headCheck = yield* Effect.either(
            tryGit(() => git.raw(['rev-parse', '--verify', '--quiet', 'HEAD']))
          )
          const headExists = Either.isRight(headCheck) && headCheck.right.trim().length > 0
          yield* tryGit(() => git.raw(trackedDiscardArgs(tracked, headExists)))
        }
        if (untracked.length > 0) {
          yield* tryGit(() => git.raw(untrackedDiscardArgs(untracked)))
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
        for (const args of discardAllArgs(headExists)) {
          yield* tryGit(() => git.raw(args))
        }
      })
    )
  })
}
