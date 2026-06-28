import { rm } from 'node:fs/promises'
import path from 'node:path'
import { GIT_EMPTY_TREE_OID } from '@shared/git-constants'
import type { CommitSummary, HeadCommit as HeadCommitInfo } from '@shared/schemas/git'
import { Effect } from 'effect'
import { buildHunksPatch, parseUnifiedDiff } from './git/diff'
import { normalizeRepoPath } from './git/instances'
import { AmendRejected, type GitError, type RepoNotOpen } from './git-errors'
import { requireOpen, tryGit } from './op-helpers'
import { withRepoLock } from './repo-lock'
import type { RepoSessions } from './repo-sessions'
import { spawnGit } from './spawn'

const NUL = '\x00'
const HEAD_FORMAT = `%H${'%x00'}%P${'%x00'}%an${'%x00'}%ae${'%x00'}%aI`

interface HeadCommit {
  sha: string
  parents: string[]
  authorName: string
  authorEmail: string
  authorDate: string
}

async function runGitOk(key: string, args: string[], stdin?: string): Promise<string> {
  const { code, stdout, stderr } = await spawnGit(['-C', key, ...args], { stdin })
  if (code !== 0) {
    throw new Error(stderr.trim() || `git ${args[0]} exited with code ${code}`)
  }
  return stdout
}

async function readHeadCommit(key: string): Promise<HeadCommit> {
  const output = await runGitOk(key, ['show', '-s', `--format=${HEAD_FORMAT}`, 'HEAD'])
  const [sha, parentsField, authorName, authorEmail, authorDate] = output.trim().split(NUL)
  return {
    sha,
    parents: parentsField.split(' ').filter((parent) => parent.length > 0),
    authorName,
    authorEmail,
    authorDate
  }
}

// Build the replacement commit as a loose object — its tree is the current index, it carries every
// original parent (so a merge stays a merge, a root stays parentless) and the preserved author, while
// the committer/committer-date advance via commit-tree's defaults. Nothing on HEAD has moved yet.
async function buildAmendedCommit(
  key: string,
  tree: string,
  head: HeadCommit,
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

// Build the rewritten commit's tree in a throwaway index so the real index stays pristine until the
// CAS lands: seed it with the would-be tree (HEAD + staged), then revert what was dropped. A whole-file
// drop reverts to the parent-commit state — `restore --staged --source=<parent>` removes an added path,
// falls a modified one back, and re-adds a deleted one, exactly like `git restore --staged
// --source=HEAD~1`. A hunk drop reverts just that slice: the file's committed diff (parent→HEAD) is
// reverse-applied for the dropped hunks, leaving the kept hunks in the commit. A root commit has no
// parent, so its base is the empty tree (the "absent" parent state).
async function buildDroppedTree(
  key: string,
  baseTree: string,
  parentSha: string | undefined,
  droppedPaths: readonly string[],
  droppedHunks: readonly DroppedHunks[]
): Promise<string> {
  const gitDir = (await runGitOk(key, ['rev-parse', '--absolute-git-dir'])).trim()
  const indexFile = path.join(gitDir, `rebase-amend-index-${process.pid}`)
  const env = { ...process.env, GIT_INDEX_FILE: indexFile }
  const base = parentSha ?? GIT_EMPTY_TREE_OID
  const run = async (args: string[], stdin?: string): Promise<string> => {
    const { code, stdout, stderr } = await spawnGit(['-C', key, ...args], { env, stdin })
    if (code !== 0) {
      throw new Error(stderr.trim() || `git ${args[0]} exited with code ${code}`)
    }
    return stdout
  }
  try {
    await run(['read-tree', baseTree])
    if (droppedPaths.length > 0) {
      if (parentSha) {
        await run(['restore', '--staged', '--source', parentSha, '--', ...droppedPaths])
      } else {
        await run(['rm', '--cached', '--ignore-unmatch', '--', ...droppedPaths])
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
        file
      ])
      const patch = buildHunksPatch(parseUnifiedDiff(raw), hunks)
      if (patch) {
        await run(['apply', '--cached', '-R', '--whitespace=nowarn', '-'], patch)
      }
    }
    return (await run(['write-tree'])).trim()
  } finally {
    await rm(indexFile, { force: true })
  }
}

// The compare-and-swap that lands the amend: update-ref refuses unless HEAD still equals expectedHead,
// so a background fetch / watcher / concurrent action advancing HEAD mid-amend is reported as
// head-moved rather than clobbered. A non-CAS failure (still pointing where we expected) is a real
// GitError and rethrown.
async function compareAndSwapHead(
  key: string,
  newSha: string,
  expectedHead: string
): Promise<'ok' | 'head-moved'> {
  const { code, stderr } = await spawnGit(['-C', key, 'update-ref', 'HEAD', newSha, expectedHead], {
    collectStdout: false
  })
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

// `--format=%B` appends a newline of its own on top of the message's stored trailing newline; git
// already normalized the message to a single trailing newline on commit, so dropping every trailing
// newline yields exactly the subject+body the panel should prefill.
function stripTrailingNewlines(message: string): string {
  return message.replace(/\n+$/, '')
}

async function readNameStatus(key: string): Promise<HeadCommitInfo['files']> {
  const output = await runGitOk(key, [
    'diff-tree',
    '--no-commit-id',
    '--name-status',
    '-r',
    '--root',
    'HEAD'
  ])
  const files: HeadCommitInfo['files'] = []
  for (const line of output.split('\n')) {
    if (line.trim().length === 0) {
      continue
    }
    const fields = line.split('\t')
    files.push({ status: fields[0], path: fields[fields.length - 1] })
  }
  return files
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
    return { result: { message, files, parentCount: head.parents.length } }
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
    ? ['diff-tree', '--numstat', '-r', firstParent, newSha]
    : ['diff-tree', '--numstat', '-r', '--root', newSha]
  const output = await runGitOk(key, args)
  let changes = 0
  let insertions = 0
  let deletions = 0
  for (const line of output.split('\n')) {
    if (line.trim().length === 0) {
      continue
    }
    changes += 1
    const [added, deleted] = line.split('\t')
    if (added !== '-') {
      insertions += Number(added)
    }
    if (deleted !== '-') {
      deletions += Number(deleted)
    }
  }
  return { changes, insertions, deletions }
}

export function amendCommit(
  repoPath: string,
  message: string,
  droppedHeadPaths: readonly string[],
  droppedHeadHunks: readonly DroppedHunks[] = []
): Effect.Effect<{ result: CommitSummary }, RepoNotOpen | GitError | AmendRejected, RepoSessions> {
  return Effect.gen(function* () {
    const key = normalizeRepoPath(repoPath)
    yield* requireOpen(key)
    const hasDrops = droppedHeadPaths.length > 0 || droppedHeadHunks.length > 0
    return yield* withRepoLock(
      key,
      Effect.gen(function* () {
        const head = yield* tryGit(() => readHeadCommit(key))
        const baseTree = yield* tryGit(() =>
          runGitOk(key, ['write-tree']).then((out) => out.trim())
        )
        const tree = hasDrops
          ? yield* tryGit(() =>
              buildDroppedTree(key, baseTree, head.parents[0], droppedHeadPaths, droppedHeadHunks)
            )
          : baseTree
        const newSha = yield* tryGit(() => buildAmendedCommit(key, tree, head, message))
        const outcome = yield* tryGit(() => compareAndSwapHead(key, newSha, head.sha))
        if (outcome === 'head-moved') {
          return yield* Effect.fail(new AmendRejected({ reason: 'head-moved' }))
        }
        // Sync the real index to the rewritten HEAD so each dropped path/hunk's HEAD version is left as
        // an uncommitted working-tree change; the no-drop path already matches HEAD, so it's skipped.
        if (hasDrops) {
          yield* tryGit(() => runGitOk(key, ['reset', '--mixed', '-q']))
        }
        const [branch, summary] = yield* tryGit(() =>
          Promise.all([currentBranchName(key), diffSummary(key, newSha, head.parents[0])])
        )
        return { result: { commit: newSha, branch, summary } }
      })
    )
  })
}
