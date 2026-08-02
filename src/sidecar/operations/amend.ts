import { rename, rm } from 'node:fs/promises'
import path from 'node:path'
import type { CommitSummary, HeadCommit as HeadCommitInfo } from '@shared/schemas/git'
import { Effect, Either } from 'effect'
import { buildHunksPatch, parseUnifiedDiff } from '../git/diff'
import {
  AmendRejected,
  type GitError,
  gitError,
  HunkNotFound,
  OperationInProgress,
  type RepoNotOpen
} from '../git/errors'
import { normalizeRepoPath } from '../git/instances'
import { literalPathspec, literalPathspecs } from '../git/pathspec'
import { spawnGit } from '../git/spawn'
import { withRepoLock } from '../session/lock'
import type { RepoSessions } from '../session/sessions'
import { amendIndexPath, readIndexTree, synchronizeIndexToCommit } from './amend-index'
import {
  type AmendHeadCommit,
  parseAmendDiffSummary,
  parseAmendHeadCommit,
  parseAmendNameStatus,
  stripTrailingNewlines
} from './amend-metadata'
import { requireOpen, tryGit } from './helpers'
import { detectInProgressOperation } from './in-progress'

const HEAD_FORMAT = `%H${'%x00'}%P${'%x00'}%an${'%x00'}%ae${'%x00'}%aI`

async function runGitOk(key: string, args: string[], stdin?: string): Promise<string> {
  const { code, stdout, stderr } = await spawnGit(['-C', key, ...args], { stdin })
  if (code !== 0) {
    throw new Error(stderr.trim() || `git ${args[0]} exited with code ${code}`)
  }
  return stdout
}

async function readHeadCommit(key: string): Promise<AmendHeadCommit> {
  const output = await runGitOk(key, ['show', '-s', `--format=${HEAD_FORMAT}`, 'HEAD'])
  return parseAmendHeadCommit(output)
}

async function buildAmendedCommit(
  key: string,
  tree: string,
  head: AmendHeadCommit,
  message: string
): Promise<string> {
  const args = ['-C', key, 'commit-tree', tree]
  for (const parent of head.parents) {
    args.push('-p', parent)
  }
  const { code, stdout, stderr } = await spawnGit(args, {
    stdin: message,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: head.authorName,
      GIT_AUTHOR_EMAIL: head.authorEmail,
      GIT_AUTHOR_DATE: head.authorDate
    }
  })
  if (code !== 0) {
    throw new Error(stderr.trim() || `git commit-tree exited with code ${code}`)
  }
  return stdout.trim()
}

export interface DroppedHunks {
  file: string
  hunks: readonly string[]
}

class StaleHunkDropError extends Error {}

interface PreparedAmendIndex {
  installPath: string
  temporaryPath: string
  tree: string
}

async function prepareDroppedIndex(
  key: string,
  baseTree: string,
  parentSha: string | undefined,
  droppedPaths: readonly string[],
  droppedHunks: readonly DroppedHunks[]
): Promise<PreparedAmendIndex> {
  const [gitDirOutput, indexPathOutput] = await Promise.all([
    runGitOk(key, ['rev-parse', '--absolute-git-dir']),
    runGitOk(key, ['rev-parse', '--git-path', 'index'])
  ])
  const temporaryPath = amendIndexPath(gitDirOutput.trim())
  const installPath = path.resolve(key, indexPathOutput.trim())
  const env = { ...process.env, GIT_INDEX_FILE: temporaryPath }
  const run = async (args: string[], stdin?: string): Promise<string> => {
    const { code, stdout, stderr } = await spawnGit(['-C', key, ...args], { env, stdin })
    if (code !== 0) {
      throw new Error(stderr.trim() || `git ${args[0]} exited with code ${code}`)
    }
    return stdout
  }
  try {
    const base = parentSha ?? (await run(['mktree'], '')).trim()
    await run(['read-tree', baseTree])
    if (droppedPaths.length > 0) {
      if (parentSha) {
        await run([
          'restore',
          '--staged',
          '--source',
          parentSha,
          '--',
          ...literalPathspecs(droppedPaths)
        ])
      } else {
        await run(['rm', '--cached', '--ignore-unmatch', '--', ...literalPathspecs(droppedPaths)])
      }
    }
    for (const { file, hunks } of droppedHunks) {
      if (hunks.length === 0) {
        continue
      }
      const raw = await run([
        'diff',
        '--no-color',
        '--no-ext-diff',
        '--unified=3',
        base,
        'HEAD',
        '--',
        literalPathspec(file)
      ])
      const patch = buildHunksPatch(parseUnifiedDiff(raw), hunks)
      if (!patch) {
        throw new StaleHunkDropError(`requested hunk not found in ${file}`)
      }
      await run(['apply', '--cached', '-R', '--whitespace=nowarn', '-'], patch)
    }
    const tree = (await run(['write-tree'])).trim()
    return { installPath, temporaryPath, tree }
  } catch (error) {
    await rm(temporaryPath, { force: true })
    throw error
  }
}

async function compareAndSwapHead(
  key: string,
  newSha: string,
  expectedHead: string
): Promise<'ok' | 'head-moved'> {
  const { code, stderr } = await spawnGit(
    ['-C', key, 'update-ref', '-m', 'amend: rewrite HEAD', 'HEAD', newSha, expectedHead],
    { collectStdout: false }
  )
  if (code === 0) {
    return 'ok'
  }
  const current = await spawnGit(['-C', key, 'rev-parse', 'HEAD']).then((result) =>
    result.stdout.trim()
  )
  if (current !== expectedHead) {
    return 'head-moved'
  }
  throw new Error(stderr.trim() || `git update-ref exited with code ${code}`)
}

async function readNameStatus(key: string): Promise<HeadCommitInfo['files']> {
  const output = await runGitOk(key, [
    'diff-tree',
    '--no-commit-id',
    '--name-status',
    '-z',
    '-r',
    '-M',
    '--root',
    'HEAD'
  ])
  return parseAmendNameStatus(output)
}

export function getHeadCommit(
  repoPath: string
): Effect.Effect<{ result: HeadCommitInfo }, RepoNotOpen | GitError, RepoSessions> {
  return Effect.gen(function* () {
    const key = normalizeRepoPath(repoPath)
    yield* requireOpen(key)
    const head = yield* tryGit(() => readHeadCommit(key))
    const message = yield* tryGit(() =>
      runGitOk(key, ['show', '-s', '--format=%B', 'HEAD']).then(stripTrailingNewlines)
    )
    const files = yield* tryGit(() => readNameStatus(key))
    return { result: { sha: head.sha, message, files, parentCount: head.parents.length } }
  })
}

export function casAdvanceHead(
  repoPath: string,
  newSha: string,
  expectedHead: string
): Effect.Effect<'ok' | 'head-moved', GitError> {
  return tryGit(() => compareAndSwapHead(normalizeRepoPath(repoPath), newSha, expectedHead))
}

async function currentBranchName(key: string): Promise<string> {
  const { code, stdout } = await spawnGit(['-C', key, 'symbolic-ref', '--short', 'HEAD'])
  return code === 0 ? stdout.trim() : 'HEAD'
}

async function diffSummary(
  key: string,
  newSha: string,
  firstParent: string | undefined
): Promise<CommitSummary['summary']> {
  const args = firstParent
    ? ['diff-tree', '--numstat', '--no-commit-id', '-r', firstParent, newSha]
    : ['diff-tree', '--numstat', '--no-commit-id', '-r', '--root', newSha]
  const output = await runGitOk(key, args)
  return parseAmendDiffSummary(output)
}

async function readHeadSha(key: string): Promise<string> {
  return (await runGitOk(key, ['rev-parse', 'HEAD'])).trim()
}

function recoveryError(message: string, error?: unknown): GitError {
  const detail = error instanceof Error ? ` ${error.message}` : ''
  return gitError(new Error(`${message} Do not retry the amend.${detail}`))
}

export function amendCommit(
  repoPath: string,
  message: string,
  droppedHeadPaths: readonly string[],
  droppedHeadHunks: readonly DroppedHunks[],
  expectedHead: string
): Effect.Effect<
  { result: CommitSummary },
  RepoNotOpen | GitError | AmendRejected | OperationInProgress | HunkNotFound,
  RepoSessions
> {
  return Effect.gen(function* () {
    const key = normalizeRepoPath(repoPath)
    yield* requireOpen(key)
    const hasDrops = droppedHeadPaths.length > 0 || droppedHeadHunks.length > 0
    return yield* withRepoLock(
      key,
      Effect.gen(function* () {
        const inProgress = yield* tryGit(() => detectInProgressOperation(key))
        if (inProgress) {
          return yield* Effect.fail(new OperationInProgress({ operation: inProgress }))
        }
        const head = yield* tryGit(() => readHeadCommit(key))
        if (head.sha !== expectedHead) {
          return yield* Effect.fail(new AmendRejected({ reason: 'head-moved' }))
        }
        const baseTree = yield* tryGit(() =>
          runGitOk(key, ['write-tree']).then((out) => out.trim())
        )
        const preparedIndex = hasDrops
          ? yield* Effect.tryPromise({
              try: () =>
                prepareDroppedIndex(
                  key,
                  baseTree,
                  head.parents[0],
                  droppedHeadPaths,
                  droppedHeadHunks
                ),
              catch: (error) =>
                error instanceof StaleHunkDropError ? new HunkNotFound() : gitError(error)
            })
          : undefined
        const transaction = Effect.gen(function* () {
          const tree = preparedIndex?.tree ?? baseTree
          const newSha = yield* tryGit(() => buildAmendedCommit(key, tree, head, message))
          const [branch, summary] = yield* tryGit(() =>
            Promise.all([currentBranchName(key), diffSummary(key, newSha, head.parents[0])])
          )
          return yield* Effect.uninterruptible(
            Effect.gen(function* () {
              const outcome = yield* tryGit(() => compareAndSwapHead(key, newSha, head.sha))
              if (outcome === 'head-moved') {
                return yield* Effect.fail(new AmendRejected({ reason: 'head-moved' }))
              }
              if (preparedIndex) {
                const installOutcome = yield* Effect.either(
                  tryGit(() => rename(preparedIndex.temporaryPath, preparedIndex.installPath))
                )
                if (Either.isLeft(installOutcome)) {
                  const rollbackOutcome = yield* Effect.either(
                    tryGit(() => compareAndSwapHead(key, head.sha, newSha))
                  )
                  if (Either.isRight(rollbackOutcome) && rollbackOutcome.right === 'ok') {
                    return yield* Effect.fail(installOutcome.left)
                  }
                  const currentHeadOutcome = yield* Effect.either(tryGit(() => readHeadSha(key)))
                  if (Either.isLeft(currentHeadOutcome)) {
                    return yield* Effect.fail(
                      recoveryError(
                        `Amend outcome could not be verified after index installation and HEAD rollback failed. Rewritten commit: ${newSha}.`,
                        currentHeadOutcome.left
                      )
                    )
                  }
                  if (currentHeadOutcome.right !== newSha) {
                    return yield* Effect.fail(
                      recoveryError(
                        `HEAD changed while recovering amend ${newSha} after index installation and HEAD rollback failed.`
                      )
                    )
                  }
                  const synchronizeOutcome = yield* Effect.either(
                    tryGit(() => synchronizeIndexToCommit(key, newSha))
                  )
                  if (Either.isLeft(synchronizeOutcome)) {
                    return yield* Effect.fail(
                      recoveryError(
                        `Amend ${newSha} landed, but the real index could not be synchronized to it.`,
                        synchronizeOutcome.left
                      )
                    )
                  }
                  const finalStateOutcome = yield* Effect.either(
                    tryGit(() => Promise.all([readHeadSha(key), readIndexTree(key)]))
                  )
                  if (
                    Either.isLeft(finalStateOutcome) ||
                    finalStateOutcome.right[0] !== newSha ||
                    finalStateOutcome.right[1] !== tree
                  ) {
                    return yield* Effect.fail(
                      recoveryError(
                        `Amend ${newSha} landed, but its final HEAD and index state could not be verified.`,
                        Either.isLeft(finalStateOutcome) ? finalStateOutcome.left : undefined
                      )
                    )
                  }
                  return { result: { commit: newSha, branch, summary } }
                }
              }
              return { result: { commit: newSha, branch, summary } }
            })
          )
        })
        if (preparedIndex) {
          return yield* transaction.pipe(
            Effect.ensuring(Effect.promise(() => rm(preparedIndex.temporaryPath, { force: true })))
          )
        }
        return yield* transaction
      })
    )
  })
}
