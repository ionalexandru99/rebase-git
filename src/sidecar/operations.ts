import { spawn } from 'node:child_process'
import path from 'node:path'
import type {
  FileDiff,
  GitBranches,
  GitLog,
  GitStatus,
  LocalBranches,
  RemoteRefs
} from '@shared/schemas/git'
import type { ResetMode, StashEntry } from '@shared/schemas/ipc'
import { Effect } from 'effect'
import type { SimpleGit } from 'simple-git'
import { fetchSemaphoreFor, releaseFetchSemaphore } from './fetch-semaphore'
import { deriveLocalShortName } from './git/checkout'
import { resolveDefaultBranch } from './git/defaultBranch'
import { buildHunkPatch, parseUnifiedDiff, toFileDiff } from './git/diff'
import { getOrCreateGit, lookupGit, normalizeRepoPath } from './git/instances'
import { LOG_FORMAT, parseGitLogOutput } from './git/log-format'
import { serializeRemotes, serializeStatus } from './git/serialize'
import {
  LOCAL_BRANCH_FORMAT,
  parseLocalBranchRefs,
  parseRemoteAndTagRefs,
  REMOTE_AND_TAG_FORMAT
} from './git/tracking'
import {
  Conflict,
  FetchSkipped,
  GitError,
  gitError,
  HunkNotFound,
  NotARepo,
  RepoNotOpen
} from './git-errors'
import { releaseRepoSemaphore, withRepoLock } from './repo-lock'
import { activeFetches, commitGraphWrites, gitInstances } from './state'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isSafeCheckoutRef(ref: string): boolean {
  return ref.length > 0 && !ref.includes('\0') && !ref.startsWith('-')
}

// Reject anything that could be read as an option flag (leading '-') or smuggle a NUL. Arguments
// are passed as an array to git (never a shell), so this is the only injection surface that matters.
// Ref-taking commands (checkout/reset/merge) additionally pass a trailing `--` so a ref that
// collides with a path can never be reinterpreted as a pathspec — defense-in-depth atop this guard.
function isSafeRefArg(value: string): boolean {
  return value.length > 0 && !value.includes('\0') && !value.startsWith('-')
}

const requireGit = (repoPath: string): Effect.Effect<SimpleGit, RepoNotOpen> =>
  Effect.suspend(() => {
    const git = lookupGit(gitInstances, repoPath)
    return git ? Effect.succeed(git) : Effect.fail(new RepoNotOpen())
  })

const requireOpen = (repoPath: string): Effect.Effect<void, RepoNotOpen> =>
  Effect.suspend(() =>
    lookupGit(gitInstances, repoPath) ? Effect.void : Effect.fail(new RepoNotOpen())
  )

const tryGit = <A>(thunk: () => Promise<A>): Effect.Effect<A, GitError> =>
  Effect.tryPromise({ try: thunk, catch: gitError })

const commitGraphWritten = new Set<string>()

// Generation numbers from a commit-graph file make `git log --topo-order` stream
// incrementally instead of walking the full history before the first row.
function ensureCommitGraph(key: string): void {
  if (commitGraphWritten.has(key)) {
    return
  }
  commitGraphWritten.add(key)
  const proc = spawn('git', ['-C', key, 'commit-graph', 'write', '--reachable', '--split'], {
    stdio: 'ignore',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
  })
  commitGraphWrites.set(key, proc)
  proc.on('error', () => {
    commitGraphWrites.delete(key)
  })
  proc.on('close', () => {
    commitGraphWrites.delete(key)
  })
}

// The real gitdir/common-dir so the main-process watcher can target HEAD/refs/index without
// running git itself: for linked worktrees and submodules `.git` is a file pointing elsewhere.
export async function resolveGitDirs(
  key: string,
  git: SimpleGit
): Promise<{ gitDir: string; commonDir: string }> {
  try {
    const output = await git.raw(['rev-parse', '--git-dir', '--git-common-dir'])
    const lines = output.split('\n').filter((line) => line.trim().length > 0)
    const gitDir = path.resolve(key, lines[0].trim())
    const commonDir = path.resolve(key, lines[1].trim())
    return { gitDir, commonDir }
  } catch {
    const gitDir = path.join(key, '.git')
    return { gitDir, commonDir: gitDir }
  }
}

interface OpenRepoResult {
  result: {
    remotes: ReturnType<typeof serializeRemotes>
    defaultBranch: string | undefined
    path: string
    gitDir: string
    commonDir: string
  }
}

export function openRepo(repoPath: string): Effect.Effect<OpenRepoResult, GitError | NotARepo> {
  return Effect.gen(function* () {
    const key = normalizeRepoPath(repoPath)
    const git = getOrCreateGit(gitInstances, key)
    const isRepo = yield* tryGit(() => git.checkIsRepo())
    if (!isRepo) {
      gitInstances.delete(key)
      return yield* Effect.fail(new NotARepo())
    }
    ensureCommitGraph(key)
    const [remotes, defaultBranch, gitDirs] = yield* tryGit(() =>
      Promise.all([
        git.getRemotes(true),
        resolveDefaultBranch(git, undefined),
        resolveGitDirs(key, git)
      ])
    )
    return {
      result: {
        remotes: serializeRemotes(remotes),
        defaultBranch,
        path: key,
        gitDir: gitDirs.gitDir,
        commonDir: gitDirs.commonDir
      }
    }
  })
}

export function closeRepo(repoPath: string): Effect.Effect<void> {
  return Effect.sync(() => {
    const key = normalizeRepoPath(repoPath)
    gitInstances.delete(key)
    const proc = activeFetches.get(key)
    if (proc && !proc.killed) {
      proc.kill()
    }
    activeFetches.delete(key)
    const graphProc = commitGraphWrites.get(key)
    if (graphProc && !graphProc.killed) {
      graphProc.kill()
    }
    commitGraphWrites.delete(key)
    commitGraphWritten.delete(key)
    releaseFetchSemaphore(key)
    releaseRepoSemaphore(key)
  })
}

// Whether a commit-graph write has been started for this repo this process. closeRepo clears the
// flag so a write interrupted by close is retried on reopen rather than skipped forever.
export function isCommitGraphTracked(repoPath: string): boolean {
  return commitGraphWritten.has(normalizeRepoPath(repoPath))
}

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

export function getStatus(
  repoPath: string
): Effect.Effect<{ status: GitStatus }, RepoNotOpen | GitError> {
  return Effect.gen(function* () {
    const git = yield* requireGit(repoPath)
    const status = yield* tryGit(() => git.status())
    return { status: serializeStatus(status) }
  })
}

export function stageFile(
  repoPath: string,
  file: string
): Effect.Effect<void, RepoNotOpen | GitError> {
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
): Effect.Effect<void, RepoNotOpen | GitError> {
  return Effect.gen(function* () {
    const git = yield* requireGit(repoPath)
    yield* withRepoLock(
      repoPath,
      tryGit(() => git.reset(['HEAD', file]))
    )
  })
}

export function stageAll(
  repoPath: string,
  files: string[]
): Effect.Effect<void, RepoNotOpen | GitError> {
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
): Effect.Effect<void, RepoNotOpen | GitError> {
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

async function readFileDiff(repoPath: string, file: string, staged: boolean): Promise<string> {
  const args = ['-C', repoPath, 'diff', ...DIFF_BASE_ARGS]
  if (staged) {
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
  staged: boolean
): Effect.Effect<{ diff: FileDiff }, RepoNotOpen | GitError> {
  return Effect.gen(function* () {
    yield* requireOpen(repoPath)
    let raw = yield* tryGit(() => readFileDiff(repoPath, file, staged))
    if (!raw && !staged) {
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
): Effect.Effect<void, RepoNotOpen | GitError | HunkNotFound> {
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
): Effect.Effect<void, RepoNotOpen | GitError | HunkNotFound> {
  return applyHunk(repoPath, file, hunkHeader, 'stage')
}

export function unstageHunk(
  repoPath: string,
  file: string,
  hunkHeader: string
): Effect.Effect<void, RepoNotOpen | GitError | HunkNotFound> {
  return applyHunk(repoPath, file, hunkHeader, 'unstage')
}

interface CommitResult {
  result: { commit: string; branch: string; summary: Record<string, unknown> }
}

export function commit(
  repoPath: string,
  message: string
): Effect.Effect<CommitResult, RepoNotOpen | GitError> {
  return Effect.gen(function* () {
    const git = yield* requireGit(repoPath)
    return yield* withRepoLock(
      repoPath,
      tryGit(() => git.commit(message)).pipe(
        Effect.map((result) => ({
          result: {
            commit: result.commit,
            branch: result.branch,
            summary: { ...result.summary }
          }
        }))
      )
    )
  })
}

interface RunGitOptions {
  okExitCodes?: number[]
  stdin?: string
}

function runGit(args: string[], options?: RunGitOptions): Promise<string> {
  const okExitCodes = options?.okExitCodes ?? [0]
  return new Promise((resolve, reject) => {
    const proc = spawn('git', args, {
      stdio: [options?.stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''

    proc.stdout?.setEncoding('utf8')
    proc.stdout?.on('data', (chunk: string) => {
      stdout += chunk
    })

    proc.stderr?.setEncoding('utf8')
    proc.stderr?.on('data', (chunk: string) => {
      stderr += chunk
      if (stderr.length > 4096) {
        stderr = stderr.slice(-4096)
      }
    })

    if (options?.stdin !== undefined) {
      proc.stdin?.end(options.stdin)
    }

    proc.on('error', reject)
    proc.on('close', (code) => {
      if (code !== null && okExitCodes.includes(code)) {
        resolve(stdout)
        return
      }
      reject(new Error(stderr.trim() || `git exited with code ${code}`))
    })
  })
}

export function getLog(
  repoPath: string,
  maxCount?: number
): Effect.Effect<{ log: GitLog }, RepoNotOpen | GitError> {
  return Effect.gen(function* () {
    yield* requireOpen(repoPath)
    const args = [
      '-C',
      repoPath,
      'log',
      '-z',
      '--branches',
      '--remotes',
      '--topo-order',
      `--format=${LOG_FORMAT}`
    ]
    if (typeof maxCount === 'number' && maxCount > 0) {
      args.splice(4, 0, `--max-count=${maxCount}`)
    }
    const raw = yield* tryGit(() => runGit(args))
    const all = parseGitLogOutput(raw)
    return { log: { all, total: all.length } }
  })
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

type GitCmdResult = { ok: true } | { ok: false; message: string }

function runFetch(key: string): Promise<GitCmdResult> {
  return new Promise((resolve) => {
    const proc = spawn(
      'git',
      ['-c', 'fetch.writeCommitGraph=true', '-C', key, 'fetch', '--prune'],
      {
        stdio: ['ignore', 'ignore', 'pipe'],
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
      }
    )
    activeFetches.set(key, proc)

    let stderrBuf = ''
    proc.stderr?.setEncoding('utf8')
    proc.stderr?.on('data', (chunk: string) => {
      stderrBuf += chunk
      if (stderrBuf.length > 4096) {
        stderrBuf = stderrBuf.slice(-4096)
      }
    })

    proc.on('error', (err) => {
      if (activeFetches.get(key) === proc) {
        activeFetches.delete(key)
      }
      resolve({ ok: false, message: err.message })
    })

    proc.on('close', (code) => {
      if (activeFetches.get(key) === proc) {
        activeFetches.delete(key)
      }
      if (code === 0) {
        resolve({ ok: true })
      } else {
        resolve({ ok: false, message: stderrBuf.trim() || `git fetch exited with code ${code}` })
      }
    })
  })
}

export function fetchRepo(
  repoPath: string
): Effect.Effect<void, RepoNotOpen | GitError | FetchSkipped> {
  return Effect.gen(function* () {
    const key = normalizeRepoPath(repoPath)
    if (!gitInstances.has(key)) {
      return yield* Effect.fail(new RepoNotOpen())
    }
    const semaphore = fetchSemaphoreFor(key)
    const outcome = yield* Effect.promise(() =>
      semaphore.withPermitsIfAvailable(() => runFetch(key))
    )
    if (outcome === null) {
      return yield* Effect.fail(new FetchSkipped())
    }
    if (!outcome.ok) {
      return yield* Effect.fail(new GitError({ message: outcome.message }))
    }
  })
}

function runGitCommand(key: string, args: string[]): Promise<GitCmdResult> {
  return new Promise((resolve) => {
    const proc = spawn('git', ['-C', key, ...args], {
      stdio: ['ignore', 'ignore', 'pipe'],
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
    })

    let stderrBuf = ''
    proc.stderr?.setEncoding('utf8')
    proc.stderr?.on('data', (chunk: string) => {
      stderrBuf += chunk
      if (stderrBuf.length > 4096) {
        stderrBuf = stderrBuf.slice(-4096)
      }
    })

    proc.on('error', (err) => {
      resolve({ ok: false, message: err.message })
    })

    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ ok: true })
      } else {
        resolve({
          ok: false,
          message: stderrBuf.trim() || `git ${args[0]} exited with code ${code}`
        })
      }
    })
  })
}

export function pushRepo(repoPath: string): Effect.Effect<void, RepoNotOpen | GitError> {
  return Effect.gen(function* () {
    const key = normalizeRepoPath(repoPath)
    if (!gitInstances.has(key)) {
      return yield* Effect.fail(new RepoNotOpen())
    }
    yield* withRepoLock(
      key,
      Effect.gen(function* () {
        const upstream = yield* Effect.promise(() =>
          runGitCommand(key, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'])
        )
        const pushArgs = upstream.ok ? ['push'] : ['push', '--set-upstream', 'origin', 'HEAD']
        const result = yield* Effect.promise(() => runGitCommand(key, pushArgs))
        if (!result.ok) {
          return yield* Effect.fail(new GitError({ message: result.message }))
        }
      }),
      { timeoutMs: null }
    )
  })
}

export function pullRepo(repoPath: string): Effect.Effect<void, RepoNotOpen | GitError> {
  return Effect.gen(function* () {
    const key = normalizeRepoPath(repoPath)
    if (!gitInstances.has(key)) {
      return yield* Effect.fail(new RepoNotOpen())
    }
    // `git pull` fetches, so it must hold the fetch semaphore that standalone fetchRepo uses —
    // otherwise a concurrent fetch and this pull race to write FETCH_HEAD/remote refs and one
    // dies on a git lock. withPermits waits for an in-flight fetch instead of skipping.
    yield* withRepoLock(
      key,
      Effect.promise(() =>
        fetchSemaphoreFor(key).withPermits(() => runGitCommand(key, ['pull', '--ff-only']))
      ).pipe(
        Effect.flatMap((result) =>
          result.ok ? Effect.void : Effect.fail(new GitError({ message: result.message }))
        )
      ),
      { timeoutMs: null }
    )
  })
}

type RawGit = { raw: (args: string[]) => Promise<string> }

async function workingTreeHasConflicts(git: RawGit): Promise<boolean> {
  const out = await git.raw(['diff', '--name-only', '--diff-filter=U'])
  return out.trim().length > 0
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

// merge/revert/cherry-pick leave the tree conflicted on failure, but simple-git's `raw` does NOT
// reject for a conflicting merge (it resolves while the index holds unmerged entries). So the
// classification has to inspect the index for unmerged paths rather than trusting the thrown error.
function runWithConflictDetection(
  repoPath: string,
  git: RawGit,
  args: string[]
): Effect.Effect<void, GitError | Conflict> {
  return withRepoLock(
    repoPath,
    Effect.gen(function* () {
      const failure = yield* Effect.promise(() =>
        git.raw(args).then(
          () => null as string | null,
          (error) => errorMessage(error)
        )
      )
      const hasConflicts = yield* tryGit(() => workingTreeHasConflicts(git))
      if (hasConflicts) {
        return yield* Effect.fail(
          new Conflict({ message: failure ?? `${args[0]} stopped on conflicts` })
        )
      }
      if (failure !== null) {
        return yield* Effect.fail(new GitError({ message: failure }))
      }
    })
  )
}

export function mergeBranch(
  repoPath: string,
  ref: string
): Effect.Effect<void, RepoNotOpen | GitError | Conflict> {
  return Effect.gen(function* () {
    const git = yield* requireGit(repoPath)
    if (!isSafeRefArg(ref)) {
      return yield* Effect.fail(new GitError({ message: 'invalid ref name' }))
    }
    yield* runWithConflictDetection(repoPath, git, ['merge', '--no-edit', ref, '--'])
  })
}

export function resetToCommit(
  repoPath: string,
  sha: string,
  mode: ResetMode
): Effect.Effect<void, RepoNotOpen | GitError> {
  return Effect.gen(function* () {
    const git = yield* requireGit(repoPath)
    if (!isSafeRefArg(sha)) {
      return yield* Effect.fail(new GitError({ message: 'invalid commit' }))
    }
    yield* withRepoLock(
      repoPath,
      tryGit(() => git.raw(['reset', `--${mode}`, sha, '--']))
    )
  })
}

export function revertCommit(
  repoPath: string,
  sha: string
): Effect.Effect<void, RepoNotOpen | GitError | Conflict> {
  return Effect.gen(function* () {
    const git = yield* requireGit(repoPath)
    if (!isSafeRefArg(sha)) {
      return yield* Effect.fail(new GitError({ message: 'invalid commit' }))
    }
    yield* runWithConflictDetection(repoPath, git, ['revert', '--no-edit', sha])
  })
}

export function cherryPick(
  repoPath: string,
  sha: string
): Effect.Effect<void, RepoNotOpen | GitError | Conflict> {
  return Effect.gen(function* () {
    const git = yield* requireGit(repoPath)
    if (!isSafeRefArg(sha)) {
      return yield* Effect.fail(new GitError({ message: 'invalid commit' }))
    }
    yield* runWithConflictDetection(repoPath, git, ['cherry-pick', sha])
  })
}

export function createTag(
  repoPath: string,
  name: string,
  ref?: string,
  message?: string
): Effect.Effect<void, RepoNotOpen | GitError> {
  return Effect.gen(function* () {
    const git = yield* requireGit(repoPath)
    if (!isSafeRefArg(name) || (ref !== undefined && !isSafeRefArg(ref))) {
      return yield* Effect.fail(new GitError({ message: 'invalid tag name' }))
    }
    yield* withRepoLock(
      repoPath,
      tryGit(() => {
        const args = message ? ['tag', '-a', name, '-m', message] : ['tag', name]
        if (ref) {
          args.push(ref)
        }
        return git.raw(args)
      })
    )
  })
}

export function deleteTag(
  repoPath: string,
  name: string
): Effect.Effect<void, RepoNotOpen | GitError> {
  return Effect.gen(function* () {
    const git = yield* requireGit(repoPath)
    if (!isSafeRefArg(name)) {
      return yield* Effect.fail(new GitError({ message: 'invalid tag name' }))
    }
    yield* withRepoLock(
      repoPath,
      tryGit(() => git.raw(['tag', '-d', name]))
    )
  })
}

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
): Effect.Effect<{ stashes: StashEntry[] }, RepoNotOpen | GitError> {
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
): Effect.Effect<void, RepoNotOpen | GitError> {
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
): Effect.Effect<void, RepoNotOpen | GitError | Conflict> {
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
): Effect.Effect<void, RepoNotOpen | GitError | Conflict> {
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
): Effect.Effect<void, RepoNotOpen | GitError> {
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

// Discard local edits to the given paths: untracked paths are deleted, tracked paths are restored
// to their committed/index baseline. The two cases need different git verbs, so classify first.
export function discardChanges(
  repoPath: string,
  files: string[]
): Effect.Effect<void, RepoNotOpen | GitError> {
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

export function discardAll(repoPath: string): Effect.Effect<void, RepoNotOpen | GitError> {
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
