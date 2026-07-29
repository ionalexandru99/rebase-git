import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export function git(cwd: string, args: string[]): void {
  const base =
    args[0] === 'commit' ? ['-c', 'commit.gpgsign=false', 'commit', '--no-gpg-sign'] : args
  execFileSync('git', args[0] === 'commit' ? [...base, ...args.slice(1)] : base, {
    cwd,
    stdio: 'ignore'
  })
}

export function gitOutput(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
}

// Windows refuses to delete a file another handle still holds, and a git child released moments ago
// (a paging process, or the background commit-graph write a session owns) can still be exiting. Close
// any open session first, then let the retries cover that window. On Linux the unlink just succeeds.
// Housekeeping, not an assertion: a git that was just killed can outhold every retry on Windows,
// and a temp directory the runner is about to throw away must not turn a passing test red.
export function removeRepoDir(repo: string): void {
  try {
    fs.rmSync(repo, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
  } catch {}
}

export function makeRepo(messages: string[]): string {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-rpc-stream-'))
  git(repo, ['init', '-b', 'main'])
  git(repo, ['config', 'user.email', 'test@example.com'])
  git(repo, ['config', 'user.name', 'Test'])
  for (const message of messages) {
    git(repo, ['commit', '--allow-empty', '-m', message])
  }
  return repo
}

// A history long enough that `git commit-graph write --reachable` stays in flight for over a second,
// which is the only lever a test has over a write the product itself starts. Cost scales with the
// commit count, and empty commits are the cheapest commits to import — no tree or blob per commit.
export function makeCommitHeavyRepo(count: number): string {
  const repo = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-commit-heavy-'))
  )
  git(repo, ['init', '-b', 'main'])
  git(repo, ['config', 'user.email', 'test@example.com'])
  git(repo, ['config', 'user.name', 'Test'])
  const lines: string[] = []
  for (let index = 1; index <= count; index++) {
    const message = `c${index}`
    lines.push('commit refs/heads/main')
    lines.push(`mark :${index}`)
    lines.push(`committer Test <test@example.com> ${1700000000 + index} +0000`)
    lines.push(`data ${Buffer.byteLength(message)}`)
    lines.push(message)
    if (index > 1) {
      lines.push(`from :${index - 1}`)
    }
    lines.push('')
  }
  execFileSync('git', ['fast-import', '--quiet'], {
    cwd: repo,
    input: `${lines.join('\n')}\n`,
    stdio: ['pipe', 'ignore', 'ignore']
  })
  return repo
}

// A linear history big enough to span many STREAM_BATCH_SIZE (500) chunks, so a stream is reliably
// still in-flight after its first chunk. fast-import builds it in one pass (a per-commit loop would be
// far too slow). Newest commit is `c${count}`; --topo-order yields newest-first.
export function makeBigRepo(count: number): string {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-rpc-stream-big-'))
  git(repo, ['init', '-b', 'main'])
  git(repo, ['config', 'user.email', 'test@example.com'])
  git(repo, ['config', 'user.name', 'Test'])
  const lines: string[] = []
  for (let index = 1; index <= count; index++) {
    const message = `c${index}`
    lines.push('commit refs/heads/main')
    lines.push(`mark :${index}`)
    lines.push(`committer Test <test@example.com> ${1700000000 + index} +0000`)
    lines.push(`data ${Buffer.byteLength(message)}`)
    lines.push(message)
    if (index > 1) {
      lines.push(`from :${index - 1}`)
    }
    const blob = `${index}`
    lines.push('M 644 inline file.txt')
    lines.push(`data ${Buffer.byteLength(blob)}`)
    lines.push(blob)
    lines.push('')
  }
  execFileSync('git', ['fast-import', '--quiet'], {
    cwd: repo,
    input: `${lines.join('\n')}\n`,
    stdio: ['pipe', 'ignore', 'ignore']
  })
  return repo
}

export type ConflictFixtureKind =
  | 'merge'
  | 'merge-both-added'
  | 'modify-delete'
  | 'rename-rename'
  | 'binary'
  | 'cherry-pick'
  | 'cherry-pick-sequence'
  | 'revert'
  | 'revert-partial'
  | 'revert-sequence'
  | 'rebase'
  | 'rebase-apply'
  | 'am'

export interface ConflictedRepo {
  path: string
  kind: ConflictFixtureKind
  // HEAD and its branch as they were immediately before the conflicting operation started — what an
  // abort has to restore. A rebase detaches HEAD, so these differ from the state under conflict.
  headBefore: string
  branchBefore: string
}

let rebaseApplySupport: boolean | undefined

// Grepping `git rebase -h` would make a wording change silently skip every test that guards on this,
// so the probe runs the backend for real in a throwaway repo. Cached: it costs a repo and a rebase.
export function supportsRebaseApplyBackend(): boolean {
  if (rebaseApplySupport !== undefined) {
    return rebaseApplySupport
  }
  const probe = fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-apply-probe-'))
  try {
    git(probe, ['init', '-b', 'main'])
    git(probe, ['config', 'user.email', 'test@example.com'])
    git(probe, ['config', 'user.name', 'Test'])
    commitRepoFile(probe, 'probe.txt', 'probe\n', 'probe')
    git(probe, ['rebase', '--apply', 'main'])
    rebaseApplySupport = true
  } catch {
    rebaseApplySupport = false
  } finally {
    removeRepoDir(probe)
  }
  return rebaseApplySupport
}

function gitIgnoringFailure(cwd: string, args: string[]): void {
  try {
    git(cwd, args)
  } catch {}
}

function initConflictRepo(label: string, config?: Record<string, string>): string {
  const repo = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), `rebase-conflict-${label}-`))
  )
  git(repo, ['init', '-b', 'main'])
  git(repo, ['config', 'user.email', 'test@example.com'])
  git(repo, ['config', 'user.name', 'Test'])
  git(repo, ['config', 'commit.gpgsign', 'false'])
  git(repo, ['config', 'core.autocrlf', 'false'])
  for (const [key, value] of Object.entries(config ?? {})) {
    git(repo, ['config', key, value])
  }
  return repo
}

export function writeRepoFile(repo: string, name: string, contents: string | Buffer): void {
  fs.writeFileSync(path.join(repo, name), contents)
}

export function readRepoFile(repo: string, name: string): string {
  return fs.readFileSync(path.join(repo, name), 'utf8')
}

function commitRepoFile(
  repo: string,
  name: string,
  contents: string | Buffer,
  message: string
): void {
  writeRepoFile(repo, name, contents)
  git(repo, ['add', '--', name])
  git(repo, ['commit', '-m', message])
}

function headSha(repo: string): string {
  return gitOutput(repo, ['rev-parse', 'HEAD']).trim()
}

function currentBranch(repo: string): string {
  return gitOutput(repo, ['rev-parse', '--abbrev-ref', 'HEAD']).trim()
}

function makeTwoSidedEdit(repo: string): void {
  commitRepoFile(repo, 'f.txt', 'base\n', 'base')
  git(repo, ['checkout', '-b', 'feature'])
  commitRepoFile(repo, 'f.txt', 'feature\n', 'feature work')
  git(repo, ['checkout', 'main'])
  commitRepoFile(repo, 'f.txt', 'main\n', 'main work')
}

function buildConflict(kind: ConflictFixtureKind, repo: string): void {
  if (kind === 'merge') {
    makeTwoSidedEdit(repo)
    return
  }
  if (kind === 'merge-both-added') {
    commitRepoFile(repo, 'README.md', 'readme\n', 'base')
    git(repo, ['checkout', '-b', 'feature'])
    commitRepoFile(repo, 'added.txt', 'from feature\n', 'feature adds')
    git(repo, ['checkout', 'main'])
    commitRepoFile(repo, 'added.txt', 'from main\n', 'main adds')
    return
  }
  if (kind === 'modify-delete') {
    commitRepoFile(repo, 'ours-kept.txt', 'base\n', 'base ours-kept')
    commitRepoFile(repo, 'theirs-kept.txt', 'base\n', 'base theirs-kept')
    git(repo, ['checkout', '-b', 'feature'])
    git(repo, ['rm', '--', 'ours-kept.txt'])
    writeRepoFile(repo, 'theirs-kept.txt', 'feature\n')
    git(repo, ['add', '--', 'theirs-kept.txt'])
    git(repo, ['commit', '-m', 'feature deletes one, edits the other'])
    git(repo, ['checkout', 'main'])
    git(repo, ['rm', '--', 'theirs-kept.txt'])
    writeRepoFile(repo, 'ours-kept.txt', 'main\n')
    git(repo, ['add', '--', 'ours-kept.txt'])
    git(repo, ['commit', '-m', 'main deletes one, edits the other'])
    return
  }
  if (kind === 'rename-rename') {
    commitRepoFile(repo, 'f.txt', 'base\n', 'base')
    git(repo, ['checkout', '-b', 'feature'])
    git(repo, ['mv', 'f.txt', 'theirs-name.txt'])
    git(repo, ['commit', '-m', 'feature renames'])
    git(repo, ['checkout', 'main'])
    git(repo, ['mv', 'f.txt', 'ours-name.txt'])
    git(repo, ['commit', '-m', 'main renames'])
    return
  }
  if (kind === 'binary') {
    commitRepoFile(repo, 'image.bin', Buffer.from([0, 1, 2, 0, 255]), 'base binary')
    git(repo, ['checkout', '-b', 'feature'])
    commitRepoFile(repo, 'image.bin', Buffer.from([0, 1, 2, 0, 3, 4]), 'feature binary')
    git(repo, ['checkout', 'main'])
    commitRepoFile(repo, 'image.bin', Buffer.from([0, 1, 2, 0, 9, 9]), 'main binary')
    return
  }
  if (kind === 'cherry-pick') {
    makeTwoSidedEdit(repo)
    return
  }
  if (kind === 'cherry-pick-sequence') {
    commitRepoFile(repo, 'a.txt', 'base\n', 'base a')
    commitRepoFile(repo, 'b.txt', 'base\n', 'base b')
    git(repo, ['checkout', '-b', 'feature'])
    commitRepoFile(repo, 'a.txt', 'feature a\n', 'feature edits a')
    commitRepoFile(repo, 'b.txt', 'feature b\n', 'feature edits b')
    git(repo, ['checkout', 'main'])
    writeRepoFile(repo, 'a.txt', 'main a\n')
    writeRepoFile(repo, 'b.txt', 'main b\n')
    git(repo, ['add', '--', 'a.txt', 'b.txt'])
    git(repo, ['commit', '-m', 'main edits both'])
    return
  }
  if (kind === 'revert') {
    commitRepoFile(repo, 'f.txt', 'one\n', 'one')
    commitRepoFile(repo, 'f.txt', 'two\n', 'two')
    commitRepoFile(repo, 'f.txt', 'three\n', 'three')
    return
  }
  // The reverted commit touches two files and only one of them has moved since, so reverting it
  // conflicts on that one and reverses the other cleanly — the clean reversal is staged straight
  // away, with nothing left in HEAD to distinguish it from an untouched path.
  if (kind === 'revert-partial') {
    writeRepoFile(repo, 'a.txt', 'a base\n')
    writeRepoFile(repo, 'b.txt', 'b base\n')
    git(repo, ['add', '--', 'a.txt', 'b.txt'])
    git(repo, ['commit', '-m', 'base'])
    writeRepoFile(repo, 'a.txt', 'a target\n')
    writeRepoFile(repo, 'b.txt', 'b target\n')
    git(repo, ['add', '--', 'a.txt', 'b.txt'])
    git(repo, ['commit', '-m', 'target of the revert'])
    commitRepoFile(repo, 'a.txt', 'a later\n', 'later work on a')
    return
  }
  if (kind === 'revert-sequence') {
    commitRepoFile(repo, 'f.txt', 'one\n', 'one')
    commitRepoFile(repo, 'f.txt', 'two\n', 'two')
    commitRepoFile(repo, 'f.txt', 'three\n', 'three')
    commitRepoFile(repo, 'f.txt', 'four\n', 'four')
    return
  }
  makeTwoSidedEdit(repo)
}

function startConflict(kind: ConflictFixtureKind, repo: string): void {
  if (
    kind === 'merge' ||
    kind === 'merge-both-added' ||
    kind === 'binary' ||
    kind === 'modify-delete' ||
    kind === 'rename-rename'
  ) {
    gitIgnoringFailure(repo, ['merge', '--no-edit', 'feature'])
    return
  }
  if (kind === 'cherry-pick') {
    gitIgnoringFailure(repo, ['cherry-pick', 'feature'])
    return
  }
  if (kind === 'cherry-pick-sequence') {
    gitIgnoringFailure(repo, ['cherry-pick', 'feature~1', 'feature'])
    return
  }
  if (kind === 'revert') {
    gitIgnoringFailure(repo, ['revert', '--no-edit', 'HEAD~1'])
    return
  }
  if (kind === 'revert-partial') {
    gitIgnoringFailure(repo, ['revert', '--no-edit', 'HEAD~1'])
    return
  }
  // A range is what makes git write a sequencer todo, which is the only place a revert's position
  // in a sequence — and the label for the step it stopped on — can be read from.
  if (kind === 'revert-sequence') {
    gitIgnoringFailure(repo, ['revert', '--no-edit', 'HEAD~2', 'HEAD~1'])
    return
  }
  if (kind === 'rebase') {
    gitIgnoringFailure(repo, ['rebase', 'main'])
    return
  }
  if (kind === 'rebase-apply') {
    gitIgnoringFailure(repo, ['rebase', '--apply', 'main'])
    return
  }
  const patchDir = path.join(repo, '.git', 'am-patches')
  git(repo, ['format-patch', '-1', '-o', patchDir, 'feature'])
  const patches = fs
    .readdirSync(patchDir)
    .filter((entry) => entry.endsWith('.patch'))
    .map((entry) => path.join(patchDir, entry))
  gitIgnoringFailure(repo, ['am', '-3', ...patches])
}

export interface ConflictFixtureOptions {
  /** `git config` entries applied before any history exists, so git's own state files honour them. */
  config?: Record<string, string>
}

// A repo parked in a real conflicted state of the given kind, built with git itself so the on-disk
// state files (rebase-merge/, sequencer/, MERGE_HEAD, …) are exactly what the product will read.
export function makeConflictedRepo(
  kind: ConflictFixtureKind,
  options?: ConflictFixtureOptions
): ConflictedRepo {
  const repo = initConflictRepo(kind, options?.config)
  buildConflict(kind, repo)
  // A rebase replays the checked-out branch, so it is `feature` that must be current — and `feature`,
  // not `main`, whose tip an abort has to restore.
  const branchAtStart = kind === 'rebase' || kind === 'rebase-apply' ? 'feature' : 'main'
  git(repo, ['checkout', branchAtStart])
  const headBefore = headSha(repo)
  const branchBefore = currentBranch(repo)
  startConflict(kind, repo)
  return { path: repo, kind, headBefore, branchBefore }
}

export interface StashConflictRepo {
  path: string
  /** The single stash entry, ready for the oid staleness check stashApply/stashPop perform. */
  stashOid: string
  file: string
  /** Committed on the branch after the stash was taken — index stage :2 once the apply conflicts. */
  oursContent: string
  /** What was stashed — index stage :3. */
  theirsContent: string
}

const STASHED_CONTENT = 'stashed\n'
const COMMITTED_CONTENT = 'committed\n'

// A repo whose single stash entry cannot be applied cleanly, left un-applied so the caller decides
// whether pop or apply is what stops on the conflict. Unlike every other fixture here the conflicted
// state it leads to has no operation behind it: git writes unmerged index entries and nothing else.
export function makeStashConflictRepo(): StashConflictRepo {
  const repo = initConflictRepo('stash')
  commitRepoFile(repo, 'f.txt', 'base\n', 'base')
  writeRepoFile(repo, 'f.txt', STASHED_CONTENT)
  git(repo, ['stash', 'push', '-m', 'stashed work'])
  commitRepoFile(repo, 'f.txt', COMMITTED_CONTENT, 'diverging work')
  return {
    path: repo,
    stashOid: gitOutput(repo, ['rev-parse', 'stash@{0}']).trim(),
    file: 'f.txt',
    oursContent: COMMITTED_CONTENT,
    theirsContent: STASHED_CONTENT
  }
}

export function conflictedPaths(repo: string): string[] {
  return gitOutput(repo, ['diff', '--name-only', '--diff-filter=U'])
    .split('\n')
    .filter((line) => line.length > 0)
}
