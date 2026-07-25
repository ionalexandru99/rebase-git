import { rm } from 'node:fs/promises'
import path from 'node:path'
import type { StashEntry } from '@shared/schemas/ipc'
import { Effect } from 'effect'
import { type Conflict, GitError, type RepoNotOpen } from '../git/errors'
import { isValidPathArg, literalPathspecs } from '../git/pathspec'
import { spawnGit } from '../git/spawn'
import { withRepoLock } from '../session/lock'
import type { RepoSessions } from '../session/sessions'
import { runWithConflictDetection } from './conflict'
import { requireGit, tryGit } from './helpers'

const STASH_FIELD_SEP = '\x1f'

interface ParsedStash {
  index: number
  ref: string
  oid: string
  message: string
  branch: string
}

function parseStashList(raw: string): ParsedStash[] {
  const stashes: ParsedStash[] = []
  for (const line of raw.split('\n')) {
    if (!line) {
      continue
    }
    const [oid, ref, subject = ''] = line.split(STASH_FIELD_SEP)
    const indexMatch = ref.match(/^stash@\{(\d+)\}$/)
    if (!indexMatch) {
      continue
    }
    const subjectMatch = subject.match(/^(?:WIP on|On) ([^:]+): (.*)$/)
    stashes.push({
      index: Number(indexMatch[1]),
      ref,
      oid,
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
    const raw = yield* tryGit(() =>
      git.raw(['stash', 'list', `--format=%H${STASH_FIELD_SEP}%gd${STASH_FIELD_SEP}%gs`])
    )
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
    if (files?.some((file) => !isValidPathArg(file))) {
      return yield* Effect.fail(new GitError({ message: 'invalid file path' }))
    }
    yield* withRepoLock(
      repoPath,
      tryGit(async () => {
        const selectedStagedFiles = files !== undefined && files.length > 0
        if (selectedStagedFiles) {
          const gitDir = (await git.raw(['rev-parse', '--absolute-git-dir'])).trim()
          const temporaryIndex = path.join(gitDir, `rebase-stash-index-${process.pid}`)
          const env = { ...process.env, GIT_INDEX_FILE: temporaryIndex }
          const run = async (args: string[], stdin?: string): Promise<string> => {
            const result = await spawnGit(['-C', repoPath, ...args], { env, stdin })
            if (result.code !== 0) {
              throw new Error(
                result.stderr.trim() || `git ${args[0]} exited with code ${result.code}`
              )
            }
            return result.stdout
          }
          try {
            await run(['read-tree', 'HEAD'])
            const patch = await git.raw([
              'diff',
              '--cached',
              '--binary',
              '--full-index',
              '--',
              ...literalPathspecs(files)
            ])
            await run(['apply', '--cached', '--whitespace=nowarn', '-'], patch)
            const args = ['stash', 'push', '--staged']
            if (message) {
              args.push('-m', message)
            }
            const output = await run(args)
            await git.raw([
              'restore',
              '--staged',
              '--source=HEAD',
              '--',
              ...literalPathspecs(files)
            ])
            return output
          } finally {
            await rm(temporaryIndex, { force: true })
          }
        }
        const args = ['stash', 'push']
        if (includeUntracked) {
          args.push('--include-untracked')
        }
        if (message) {
          args.push('-m', message)
        }
        return git.raw(args)
      })
    )
  })
}

function stashRef(index: number): string | null {
  return Number.isInteger(index) && index >= 0 ? `stash@{${index}}` : null
}

async function verifyStashOid(
  git: { raw: (args: string[]) => Promise<string> },
  ref: string,
  expectedOid: string
): Promise<void> {
  const actualOid = (await git.raw(['rev-parse', ref])).trim()
  if (actualOid !== expectedOid) {
    throw new Error('stash changed since it was listed')
  }
}

export function stashApply(
  repoPath: string,
  index: number,
  expectedOid: string
): Effect.Effect<void, RepoNotOpen | GitError | Conflict, RepoSessions> {
  return Effect.gen(function* () {
    const git = yield* requireGit(repoPath)
    const ref = stashRef(index)
    if (!ref) {
      return yield* Effect.fail(new GitError({ message: 'invalid stash index' }))
    }
    yield* runWithConflictDetection(repoPath, git, ['stash', 'apply', ref], () =>
      verifyStashOid(git, ref, expectedOid)
    )
  })
}

export function stashPop(
  repoPath: string,
  index: number,
  expectedOid: string
): Effect.Effect<void, RepoNotOpen | GitError | Conflict, RepoSessions> {
  return Effect.gen(function* () {
    const git = yield* requireGit(repoPath)
    const ref = stashRef(index)
    if (!ref) {
      return yield* Effect.fail(new GitError({ message: 'invalid stash index' }))
    }
    yield* runWithConflictDetection(repoPath, git, ['stash', 'pop', ref], () =>
      verifyStashOid(git, ref, expectedOid)
    )
  })
}

export function stashDrop(
  repoPath: string,
  index: number,
  expectedOid: string
): Effect.Effect<void, RepoNotOpen | GitError, RepoSessions> {
  return Effect.gen(function* () {
    const git = yield* requireGit(repoPath)
    const ref = stashRef(index)
    if (!ref) {
      return yield* Effect.fail(new GitError({ message: 'invalid stash index' }))
    }
    yield* withRepoLock(
      repoPath,
      Effect.gen(function* () {
        yield* tryGit(() => verifyStashOid(git, ref, expectedOid))
        yield* tryGit(() => git.raw(['stash', 'drop', ref]))
      })
    )
  })
}
