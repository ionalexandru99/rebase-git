import type { CommitDetail } from '@shared/schemas/git'
import { Effect } from 'effect'
import { buildCommitFiles, parseCommitNameStatus, parseCommitNumstat } from '../git/commit-files'
import { GitError, type RepoNotOpen } from '../git/errors'
import { normalizeRepoPath } from '../git/instances'
import { isSafeRefArg } from '../git/ref-args'
import { runGit } from '../git/spawn'
import type { RepoSessions } from '../session/sessions'
import { requireOpen, tryGit } from './helpers'

const NUL = '\x00'
const NUL_FORMAT = '%x00'
const META_FIELDS = ['%H', '%P', '%an', '%ae', '%aI', '%cn', '%ce', '%cI', '%s', '%b'] as const
const META_FORMAT = META_FIELDS.join(NUL_FORMAT)

interface CommitMeta {
  sha: string
  parents: string[]
  author: { name: string; email: string }
  authorDate: string
  committer: { name: string; email: string }
  commitDate: string
  subject: string
  body: string
}

function parseCommitMeta(output: string): CommitMeta {
  const [
    sha,
    parentsField,
    authorName,
    authorEmail,
    authorDate,
    committerName,
    committerEmail,
    commitDate,
    subject,
    body
  ] = output.split(NUL)
  return {
    sha,
    parents: parentsField.split(' ').filter((parent) => parent.length > 0),
    author: { name: authorName, email: authorEmail },
    authorDate,
    committer: { name: committerName, email: committerEmail },
    commitDate,
    subject,
    // %b keeps the trailing newlines git stores; the panel renders the body verbatim.
    body: body.replace(/\n+$/, '')
  }
}

// A commit's own diff-tree output is empty for a merge, so the base is always named explicitly:
// the first parent, or --root for a commit that has none.
function fileListArgs(repoPath: string, meta: CommitMeta, format: string): string[] {
  const base = ['-C', repoPath, 'diff-tree', '--no-commit-id', format, '-z', '-r', '-M']
  const firstParent = meta.parents[0]
  return firstParent ? [...base, firstParent, meta.sha] : [...base, '--root', meta.sha]
}

export function getCommitDetail(
  repoPath: string,
  sha: string
): Effect.Effect<{ detail: CommitDetail }, RepoNotOpen | GitError, RepoSessions> {
  return Effect.gen(function* () {
    const key = normalizeRepoPath(repoPath)
    yield* requireOpen(key)
    if (!isSafeRefArg(sha)) {
      return yield* Effect.fail(new GitError({ message: `unsafe commit: ${sha}` }))
    }
    const meta = yield* tryGit(() =>
      runGit(['-C', key, 'show', '-s', `--format=${META_FORMAT}`, sha, '--']).then(parseCommitMeta)
    )
    const [nameStatus, numstat] = yield* tryGit(() =>
      Promise.all([
        runGit(fileListArgs(key, meta, '--name-status')),
        runGit(fileListArgs(key, meta, '--numstat'))
      ])
    )
    return {
      detail: {
        ...meta,
        files: buildCommitFiles(parseCommitNameStatus(nameStatus), parseCommitNumstat(numstat))
      }
    }
  })
}
