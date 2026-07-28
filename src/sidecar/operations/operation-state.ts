import fs from 'node:fs'
import path from 'node:path'
import type { ConflictOperationKind, OperationState } from '@shared/schemas/git'
import { nonInteractiveEnv, runGit } from '../git/spawn'

const SHORT_SHA_LENGTH = 7
const HEAD_REF_PREFIX = 'ref: refs/heads/'
const BRANCH_REF_PREFIX = 'refs/heads/'

function readText(file: string): string | undefined {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch {
    return undefined
  }
}

function readTrimmed(file: string): string | undefined {
  return readText(file)?.trim() || undefined
}

function readFirstLine(file: string): string | undefined {
  return readText(file)?.split('\n')[0].trim() || undefined
}

function readCount(file: string): number | undefined {
  const value = Number(readTrimmed(file))
  return Number.isInteger(value) ? value : undefined
}

function pathExists(target: string): boolean {
  return fs.existsSync(target)
}

function isDirectory(target: string): boolean {
  try {
    return fs.statSync(target).isDirectory()
  } catch {
    return false
  }
}

function shortSha(sha: string): string {
  return sha.slice(0, SHORT_SHA_LENGTH)
}

// git's own resolution rule, done with two filesystem reads instead of a spawn: `.git` is a
// directory in a normal clone and a `gitdir:` pointer file in a linked worktree or a submodule,
// where the per-worktree state files (rebase-merge/, MERGE_HEAD, …) live at the pointed-to path.
export function resolveGitDir(repoPath: string): string {
  const dotGit = path.join(repoPath, '.git')
  if (isDirectory(dotGit)) {
    return dotGit
  }
  const pointer = readTrimmed(dotGit)
  const match = pointer?.match(/^gitdir:\s*(.+)$/m)
  if (match) {
    return path.resolve(repoPath, match[1].trim())
  }
  return pathExists(dotGit) ? dotGit : repoPath
}

function currentHeadLabel(gitDir: string): string {
  const head = readTrimmed(path.join(gitDir, 'HEAD')) ?? ''
  if (head.startsWith(HEAD_REF_PREFIX)) {
    return head.slice(HEAD_REF_PREFIX.length)
  }
  return shortSha(head)
}

async function readGit(repoPath: string, args: string[]): Promise<string> {
  try {
    return (await runGit(['-C', repoPath, ...args], { env: nonInteractiveEnv() })).trim()
  } catch {
    return ''
  }
}

// The friendliest name a sha answers to. name-rev walks refs, so a tip resolves to its branch and an
// older commit to `branch~n`; `remotes/` is noise once the rest of the name identifies the remote.
async function refNameFor(repoPath: string, sha: string): Promise<string> {
  const name = await readGit(repoPath, ['name-rev', '--name-only', '--no-undefined', sha])
  if (!name) {
    return shortSha(sha)
  }
  return name.replace(/^remotes\//, '').replace(/\^0$/, '')
}

async function commitLabel(repoPath: string, sha: string): Promise<string> {
  const summary = await readGit(repoPath, ['log', '-1', '--format=%h %s', sha, '--'])
  return summary || shortSha(sha)
}

async function countCommitsSince(repoPath: string, sha: string): Promise<number> {
  const count = Number(await readGit(repoPath, ['rev-list', '--count', `${sha}..HEAD`]))
  return Number.isInteger(count) && count >= 0 ? count : 0
}

// The renderer prefills the commit box with this, and `git commit -m` cleans up whitespace only —
// so the "Conflicts:" block MERGE_MSG carries would land verbatim in the commit. What counts as a
// comment line is the repo's own core.commentChar/commentString, which is exactly what `git
// stripspace` applies; assuming '#' leaks the block on any repo that configured something else.
async function stripMessageComments(repoPath: string, message: string): Promise<string> {
  try {
    const stripped = await runGit(['-C', repoPath, 'stripspace', '--strip-comments'], {
      env: nonInteractiveEnv(),
      stdin: message
    })
    return stripped.trim()
  } catch {
    return message
      .split('\n')
      .filter((line) => !line.startsWith('#'))
      .join('\n')
      .trim()
  }
}

async function rebaseState(
  repoPath: string,
  gitDir: string,
  stateDir: string,
  kind: 'rebase-merge' | 'rebase-apply',
  doneFile: string,
  totalFile: string
): Promise<OperationState | undefined> {
  const onto = readTrimmed(path.join(stateDir, 'onto'))
  const headName = readTrimmed(path.join(stateDir, 'head-name')) ?? ''
  const origHead = readTrimmed(path.join(stateDir, 'orig-head'))
  // An external `rebase --quit`/`--abort` can delete the directory between the isDirectory check and
  // these reads. Nothing identifying left means no rebase, not a rebase with placeholder labels.
  if (onto === undefined && headName.length === 0) {
    return undefined
  }
  const theirsLabel = headName.startsWith(BRANCH_REF_PREFIX)
    ? headName.slice(BRANCH_REF_PREFIX.length)
    : origHead
      ? shortSha(origHead)
      : 'HEAD'
  return {
    kind,
    oursLabel: onto ? await refNameFor(repoPath, onto) : currentHeadLabel(gitDir),
    theirsLabel,
    done: readCount(path.join(stateDir, doneFile)),
    total: readCount(path.join(stateDir, totalFile))
  }
}

function amState(gitDir: string, stateDir: string): OperationState | undefined {
  const subject = readFirstLine(path.join(stateDir, 'final-commit'))
  const done = readCount(path.join(stateDir, 'next'))
  const total = readCount(path.join(stateDir, 'last'))
  if (subject === undefined && done === undefined && total === undefined) {
    return undefined
  }
  return {
    kind: 'am',
    oursLabel: currentHeadLabel(gitDir),
    theirsLabel: subject ?? 'patch',
    done,
    total
  }
}

// A multi-commit cherry-pick/revert. `sequencer/todo` holds the instructions still to run, current
// one included, and `sequencer/head` the tip the sequence started from — so the commits already made
// since that tip give the position within a total git never writes down.
async function sequencerState(
  repoPath: string,
  gitDir: string
): Promise<OperationState | undefined> {
  const sequencerDir = path.join(gitDir, 'sequencer')
  const todo = readText(path.join(sequencerDir, 'todo'))
  if (todo === undefined) {
    return undefined
  }
  const instructions = todo
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
  if (instructions.length === 0) {
    return undefined
  }
  const kind: ConflictOperationKind =
    instructions[0].split(/\s+/)[0] === 'revert' ? 'revert' : 'cherry-pick'
  const stoppedAt = readTrimmed(
    path.join(gitDir, kind === 'revert' ? 'REVERT_HEAD' : 'CHERRY_PICK_HEAD')
  )
  const sequenceStart = readTrimmed(path.join(sequencerDir, 'head'))
  const applied = sequenceStart ? await countCommitsSince(repoPath, sequenceStart) : 0
  return {
    kind,
    oursLabel: currentHeadLabel(gitDir),
    theirsLabel: stoppedAt ? await commitLabel(repoPath, stoppedAt) : instructions[0],
    done: applied + 1,
    total: applied + instructions.length
  }
}

async function singlePickState(
  repoPath: string,
  gitDir: string,
  kind: 'cherry-pick' | 'revert',
  sha: string
): Promise<OperationState> {
  return {
    kind,
    oursLabel: currentHeadLabel(gitDir),
    theirsLabel: await commitLabel(repoPath, sha)
  }
}

async function mergeState(
  repoPath: string,
  gitDir: string,
  mergeHead: string
): Promise<OperationState> {
  const mergeMessage = readText(path.join(gitDir, 'MERGE_MSG'))
  return {
    kind: 'merge',
    oursLabel: currentHeadLabel(gitDir),
    theirsLabel: await refNameFor(repoPath, mergeHead.split('\n')[0].trim()),
    mergeMessage:
      mergeMessage === undefined ? undefined : await stripMessageComments(repoPath, mergeMessage)
  }
}

// One read of the repo's state files, in git's own precedence order: a rebase owns the tree even
// though it also leaves CHERRY_PICK_HEAD-style markers behind, and a sequencer todo outranks the
// single-commit markers because those name only the commit the sequence is currently stopped on.
export async function detectOperationState(repoPath: string): Promise<OperationState | undefined> {
  const gitDir = resolveGitDir(repoPath)

  const rebaseMergeDir = path.join(gitDir, 'rebase-merge')
  if (isDirectory(rebaseMergeDir)) {
    return rebaseState(repoPath, gitDir, rebaseMergeDir, 'rebase-merge', 'msgnum', 'end')
  }

  const rebaseApplyDir = path.join(gitDir, 'rebase-apply')
  if (isDirectory(rebaseApplyDir)) {
    return pathExists(path.join(rebaseApplyDir, 'applying'))
      ? amState(gitDir, rebaseApplyDir)
      : rebaseState(repoPath, gitDir, rebaseApplyDir, 'rebase-apply', 'next', 'last')
  }

  const sequencer = await sequencerState(repoPath, gitDir)
  if (sequencer) {
    return sequencer
  }

  const cherryPickHead = readTrimmed(path.join(gitDir, 'CHERRY_PICK_HEAD'))
  if (cherryPickHead) {
    return singlePickState(repoPath, gitDir, 'cherry-pick', cherryPickHead)
  }

  const revertHead = readTrimmed(path.join(gitDir, 'REVERT_HEAD'))
  if (revertHead) {
    return singlePickState(repoPath, gitDir, 'revert', revertHead)
  }

  const mergeHead = readTrimmed(path.join(gitDir, 'MERGE_HEAD'))
  if (mergeHead) {
    return mergeState(repoPath, gitDir, mergeHead)
  }

  return undefined
}
