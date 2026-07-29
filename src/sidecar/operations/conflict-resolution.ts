import type { ConflictOperationKind } from '@shared/schemas/git'
import { Effect } from 'effect'
import { Conflict, GitError, type RepoNotOpen } from '../git/errors'
import { isValidPathArg, literalPathspec } from '../git/pathspec'
import { nonInteractiveEnv, runGit, spawnGit } from '../git/spawn'
import { withRepoLock } from '../session/lock'
import type { RepoSessions } from '../session/sessions'
import { requireOpen, tryGit } from './helpers'
import { detectOperationState } from './operation-state'

export type ConflictSide = 'ours' | 'theirs'

const OURS_STAGE = 2
const THEIRS_STAGE = 3

const ABORT_ARGS: Record<ConflictOperationKind, string[]> = {
  merge: ['merge', '--abort'],
  'rebase-merge': ['rebase', '--abort'],
  'rebase-apply': ['rebase', '--abort'],
  am: ['am', '--abort'],
  'cherry-pick': ['cherry-pick', '--abort'],
  revert: ['revert', '--abort']
}

// A merge has no `--continue`: the conflicted merge is finished by committing the index, which picks
// up the MERGE_MSG git already prepared.
const CONTINUE_ARGS: Record<ConflictOperationKind, string[]> = {
  merge: ['commit', '--no-edit'],
  'rebase-merge': ['rebase', '--continue'],
  'rebase-apply': ['rebase', '--continue'],
  am: ['am', '--continue'],
  'cherry-pick': ['cherry-pick', '--continue'],
  revert: ['revert', '--continue']
}

// Steps git can drop on request. A merge has no `--skip` and never needs one — its commit records a
// second parent, so an unchanged tree still has something to write. `am` is left out on purpose: a
// patch it failed to apply at all also leaves nothing staged, and there the empty index means "edit
// these files yourself", so skipping would silently throw the patch away.
const SKIP_ARGS: Partial<Record<ConflictOperationKind, string[]>> = {
  'rebase-merge': ['rebase', '--skip'],
  'rebase-apply': ['rebase', '--skip'],
  'cherry-pick': ['cherry-pick', '--skip'],
  revert: ['revert', '--skip']
}

async function runControlGit(repoPath: string, args: string[]): Promise<string | null> {
  const { code, stdout, stderr } = await spawnGit(['-C', repoPath, ...args], {
    env: nonInteractiveEnv()
  })
  if (code === 0) {
    return null
  }
  return (
    [stderr.trim(), stdout.trim()].filter(Boolean).join('\n') ||
    `git ${args[0]} exited with code ${code}`
  )
}

export async function unmergedPaths(repoPath: string): Promise<string[]> {
  const output = await runGit(['-C', repoPath, 'diff', '--name-only', '--diff-filter=U', '-z'], {
    env: nonInteractiveEnv()
  })
  return output.split('\0').filter((entry) => entry.length > 0)
}

// `<mode> <sha> <stage>\t<path>` per unmerged index entry: stage 1 is the merge base, 2 ours, 3
// theirs. A side missing from that set is a side that deleted the file.
async function conflictStages(repoPath: string, file: string): Promise<Set<number>> {
  const output = await runGit(
    ['-C', repoPath, 'ls-files', '-u', '-z', '--', literalPathspec(file)],
    { env: nonInteractiveEnv() }
  )
  const stages = new Set<number>()
  for (const record of output.split('\0')) {
    if (record.length === 0) {
      continue
    }
    const stage = Number(record.split('\t')[0].split(' ')[2])
    if (Number.isInteger(stage)) {
      stages.add(stage)
    }
  }
  return stages
}

// Whether the step git just refused to finish has nothing left to record. The wording of that
// refusal varies by operation and by rebase backend ("is now empty", "nothing to commit", "No
// changes"), so the index decides instead: no unmerged entry and nothing staged that differs from
// HEAD means neither committing nor resolving can move this step forward.
//
// Staged, not the whole working tree: an unrelated unstaged edit the user happened to be carrying is
// not part of the step, and counting it would suppress the skip and strand the operation with no way
// forward — `--continue` would keep refusing for a change it is never going to commit.
async function stepHasNothingToCommit(repoPath: string): Promise<boolean> {
  if ((await unmergedPaths(repoPath)).length > 0) {
    return false
  }
  const { code } = await spawnGit(['-C', repoPath, 'diff', '--cached', '--quiet', 'HEAD', '--'], {
    env: nonInteractiveEnv()
  })
  return code === 0
}

export function abortOperation(
  repoPath: string
): Effect.Effect<void, RepoNotOpen | GitError, RepoSessions> {
  return Effect.gen(function* () {
    yield* requireOpen(repoPath)
    yield* withRepoLock(
      repoPath,
      Effect.gen(function* () {
        const operation = yield* tryGit(() => detectOperationState(repoPath))
        if (!operation) {
          return yield* Effect.fail(new GitError({ message: 'no git operation in progress' }))
        }
        const failure = yield* tryGit(() => runControlGit(repoPath, ABORT_ARGS[operation.kind]))
        if (failure !== null) {
          return yield* Effect.fail(new GitError({ message: failure }))
        }
      })
    )
  })
}

export function continueOperation(
  repoPath: string
): Effect.Effect<void, RepoNotOpen | GitError | Conflict, RepoSessions> {
  return Effect.gen(function* () {
    yield* requireOpen(repoPath)
    yield* withRepoLock(
      repoPath,
      Effect.gen(function* () {
        const operation = yield* tryGit(() => detectOperationState(repoPath))
        if (!operation) {
          return yield* Effect.fail(new GitError({ message: 'no git operation in progress' }))
        }
        // Checked up front so a caller who has not finished resolving gets a clear refusal and the
        // repo is left untouched — otherwise git's own failure is indistinguishable from the next
        // commit of a sequence conflicting.
        const unresolved = yield* tryGit(() => unmergedPaths(repoPath))
        if (unresolved.length > 0) {
          return yield* Effect.fail(
            new GitError({
              message: `resolve the remaining conflicts before continuing: ${unresolved.join(', ')}`
            })
          )
        }
        let failure = yield* tryGit(() => runControlGit(repoPath, CONTINUE_ARGS[operation.kind]))
        const skipArgs = SKIP_ARGS[operation.kind]
        if (failure !== null && skipArgs !== undefined) {
          // Resolving toward the side already in HEAD is how a step ends up empty, and it is also
          // the user saying they want the incoming commit dropped — so carry that out. Whatever the
          // skip lands on next is handled below like any other outcome of continuing.
          const nothingToCommit = yield* tryGit(() => stepHasNothingToCommit(repoPath))
          if (nothingToCommit) {
            failure = yield* tryGit(() => runControlGit(repoPath, skipArgs))
          }
        }
        const stopped = yield* tryGit(() => unmergedPaths(repoPath))
        if (stopped.length > 0) {
          return yield* Effect.fail(
            new Conflict({ message: failure ?? `${operation.kind} stopped on conflicts` })
          )
        }
        if (failure !== null) {
          return yield* Effect.fail(new GitError({ message: failure }))
        }
      })
    )
  })
}

// Conflict markers are never parsed: the index already holds both sides as stages 2 and 3, so taking
// a side is a checkout of that stage — and a side with no stage is a side that deleted the file,
// which makes "keep it" and "delete it" the same call for modify/delete and both-deleted conflicts.
export function resolveConflict(
  repoPath: string,
  file: string,
  side: ConflictSide
): Effect.Effect<void, RepoNotOpen | GitError, RepoSessions> {
  return Effect.gen(function* () {
    yield* requireOpen(repoPath)
    if (!isValidPathArg(file)) {
      return yield* Effect.fail(new GitError({ message: 'invalid file path' }))
    }
    yield* withRepoLock(
      repoPath,
      Effect.gen(function* () {
        const stages = yield* tryGit(() => conflictStages(repoPath, file))
        if (stages.size === 0) {
          return yield* Effect.fail(new GitError({ message: `no conflict to resolve in ${file}` }))
        }
        const pathspec = literalPathspec(file)
        const env = nonInteractiveEnv()
        if (stages.has(side === 'ours' ? OURS_STAGE : THEIRS_STAGE)) {
          yield* tryGit(() =>
            runGit(['-C', repoPath, 'checkout', `--${side}`, '--', pathspec], { env })
          )
          yield* tryGit(() => runGit(['-C', repoPath, 'add', '--', pathspec], { env }))
          return
        }
        yield* tryGit(() => runGit(['-C', repoPath, 'rm', '-f', '--', pathspec], { env }))
      })
    )
  })
}
