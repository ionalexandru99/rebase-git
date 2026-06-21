import type { GitBranches, LocalBranches, RemoteRefs } from '@shared/schemas/git'
import { Effect } from 'effect'
import { deriveLocalShortName } from './git/checkout'
import {
  LOCAL_BRANCH_FORMAT,
  parseLocalBranchRefs,
  parseRemoteAndTagRefs,
  REMOTE_AND_TAG_FORMAT
} from './git/tracking'
import { GitError, type RepoNotOpen } from './git-errors'
import { requireGit, tryGit } from './op-helpers'
import { isSafeCheckoutRef, isSafeRefArg } from './ref-args'
import { withRepoLock } from './repo-lock'

export function getLocalBranches(
  repoPath: string
): Effect.Effect<{ branches: LocalBranches }, RepoNotOpen | GitError> {
  return Effect.gen(function* () {
    const git = yield* requireGit(repoPath)
    const raw = yield* tryGit(() =>
      git.raw(['for-each-ref', 'refs/heads', `--format=${LOCAL_BRANCH_FORMAT}`])
    )
    return { branches: parseLocalBranchRefs(raw) }
  })
}

export function getRemoteRefs(
  repoPath: string
): Effect.Effect<{ refs: RemoteRefs }, RepoNotOpen | GitError> {
  return Effect.gen(function* () {
    const git = yield* requireGit(repoPath)
    const raw = yield* tryGit(() =>
      git.raw(['for-each-ref', 'refs/remotes', 'refs/tags', `--format=${REMOTE_AND_TAG_FORMAT}`])
    )
    return { refs: parseRemoteAndTagRefs(raw) }
  })
}

export function getBranches(
  repoPath: string
): Effect.Effect<{ branches: GitBranches }, RepoNotOpen | GitError> {
  return Effect.all([getLocalBranches(repoPath), getRemoteRefs(repoPath)], {
    concurrency: 'unbounded'
  }).pipe(Effect.map(([local, remote]) => ({ branches: { ...local.branches, ...remote.refs } })))
}

export function checkoutRef(
  repoPath: string,
  refKind: 'local' | 'remote' | 'tag',
  fullPath: string
): Effect.Effect<{ checkedOut: string }, RepoNotOpen | GitError> {
  return Effect.gen(function* () {
    const git = yield* requireGit(repoPath)
    if (!isSafeCheckoutRef(fullPath)) {
      return yield* Effect.fail(new GitError({ message: 'invalid ref name' }))
    }
    return yield* withRepoLock(
      repoPath,
      Effect.gen(function* () {
        if (refKind === 'remote') {
          yield* Effect.tryPromise({
            try: () => git.raw(['show-ref', '--verify', `refs/remotes/${fullPath}`]),
            catch: () => new GitError({ message: `Remote branch '${fullPath}' does not exist` })
          })
          const shortName = deriveLocalShortName(fullPath)
          const existing = yield* tryGit(() => git.branch(['--list', shortName]))
          if (existing.all.length > 0) {
            const upstreamRaw = yield* tryGit(() =>
              git.raw(['for-each-ref', `refs/heads/${shortName}`, '--format=%(upstream:short)'])
            )
            const upstream = upstreamRaw.trim()
            if (upstream !== fullPath) {
              return yield* Effect.fail(
                new GitError({
                  message: `Local branch '${shortName}' tracks ${upstream || 'no remote'}, not ${fullPath}. Resolve manually.`
                })
              )
            }
            yield* tryGit(() => git.checkout([shortName, '--']))
          } else {
            yield* tryGit(() => git.checkout(['--track', fullPath, '--']))
          }
          return { checkedOut: shortName }
        }
        yield* tryGit(() => git.checkout([fullPath, '--']))
        return { checkedOut: fullPath }
      })
    )
  })
}

export function createBranch(
  repoPath: string,
  name: string,
  startPoint?: string,
  checkout?: boolean
): Effect.Effect<void, RepoNotOpen | GitError> {
  return Effect.gen(function* () {
    const git = yield* requireGit(repoPath)
    if (!isSafeRefArg(name) || (startPoint !== undefined && !isSafeRefArg(startPoint))) {
      return yield* Effect.fail(new GitError({ message: 'invalid branch name' }))
    }
    yield* withRepoLock(
      repoPath,
      tryGit(() => {
        const args = checkout ? ['checkout', '-b', name] : ['branch', name]
        if (startPoint) {
          args.push(startPoint)
        }
        return git.raw(args)
      })
    )
  })
}

export function deleteBranch(
  repoPath: string,
  name: string,
  force?: boolean
): Effect.Effect<void, RepoNotOpen | GitError> {
  return Effect.gen(function* () {
    const git = yield* requireGit(repoPath)
    if (!isSafeRefArg(name)) {
      return yield* Effect.fail(new GitError({ message: 'invalid branch name' }))
    }
    yield* withRepoLock(
      repoPath,
      tryGit(() => git.raw(['branch', force ? '-D' : '-d', name]))
    )
  })
}

export function renameBranch(
  repoPath: string,
  oldName: string,
  newName: string
): Effect.Effect<void, RepoNotOpen | GitError> {
  return Effect.gen(function* () {
    const git = yield* requireGit(repoPath)
    if (!isSafeRefArg(oldName) || !isSafeRefArg(newName)) {
      return yield* Effect.fail(new GitError({ message: 'invalid branch name' }))
    }
    yield* withRepoLock(
      repoPath,
      tryGit(() => git.raw(['branch', '-m', oldName, newName]))
    )
  })
}
