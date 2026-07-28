import crypto from 'node:crypto'
import fs from 'node:fs'
import nodePath from 'node:path'
import { isSafeCloneFolderName, isSupportedCloneUrl } from '@shared/clone-url'
import type { CloneProgress } from '@shared/schemas/git'
import { Effect, Stream } from 'effect'
import { applyNonInteractiveGitEnv } from '../git/environment'
import { GitError } from '../git/errors'
import { resolveDirectoryWithinHome } from '../git/path-guards'
import { type RunningGitProcess, startGit } from '../git/spawn'

export interface CloneRequest {
  url: string
  parentDir: string
  folderName: string
}

const INVALID_URL = 'that does not look like a repository URL'
const INVALID_DESTINATION = 'invalid destination folder'
const INVALID_FOLDER_NAME = 'invalid folder name for the clone'

// git writes progress to stderr as `Receiving objects:  47% (470/1000)`, optionally prefixed with
// `remote: ` for the phases the server drives. Lines without a percentage ("Cloning into…") carry no
// progress, so they are dropped rather than shown as a phase that never advances.
const PROGRESS_LINE = /^(?:remote:\s*)?([A-Za-z][A-Za-z0-9 ]*?):\s+(\d{1,3})%/

export function parseCloneProgress(line: string): { phase: string; percent: number } | null {
  const match = PROGRESS_LINE.exec(line.trim())
  if (!match) {
    return null
  }
  const percent = Number(match[2])
  return percent >= 0 && percent <= 100 ? { phase: match[1], percent } : null
}

// git's stderr is mostly progress redraws; what the user needs is the `fatal:`/`remote:` tail that
// says why it stopped. Hints are dropped unless they are all there is.
export function cloneFailureMessage(stderr: string, code: number | null): string {
  const lines = stderr
    .split(/[\r\n]/)
    .map((line) => line.trim())
    .filter(
      (line) => line.length > 0 && !line.startsWith('Cloning into') && !parseCloneProgress(line)
    )
  const withoutHints = lines.filter((line) => !line.startsWith('hint:'))
  const tail = (withoutHints.length > 0 ? withoutHints : lines).slice(-4)
  return tail.join('\n') || `git clone exited with code ${code}`
}

// git writes into a staging directory next to the destination, and the result is renamed into place
// only once the whole clone has finished. The destination is therefore never half-written: a clone
// that fails, is cancelled, or takes the sidecar down with it leaves at most a staging directory
// behind — and staging directories carry a name only we create, so the next attempt at the same
// folder can sweep them without ever having to judge whether a repository is somebody's real work.
interface CloneTarget {
  url: string
  path: string
  stagingPath: string
  claimKey: string
}

const stagingPrefix = (folderName: string): string => `.${folderName}.rebase-clone-`
const STAGING_SUFFIX = /^[0-9a-f]{8}$/

// A staging directory holds a real working tree while git writes it, so anything that lists
// repositories has to know to look away — the workspace scan would otherwise offer a half-written
// clone as something to open.
export function isCloneStagingName(name: string): boolean {
  return /^\..+\.rebase-clone-[0-9a-f]{8}$/.test(name)
}

// A clone that is torn down while git is still connecting can take a moment to bring the process
// group down, and the failure it is holding up is on its way to the UI. The force-kill inside
// terminate lands well before this, so reaching the bound means something is stuck, not slow.
const TERMINATE_TIMEOUT_MS = 5_000

// How long the staging sweep keeps trying, and how often. Long enough to outlast a git that is
// slow to let go on Windows, short enough that it is not still churning the filesystem long after
// the clone it belongs to is forgotten — a staging directory it fails to clear is litter no retry
// will ever aim at, and the next attempt at the same folder sweeps it again.
const CLEANUP_TIMEOUT_MS = 5_000
const CLEANUP_RETRY_MS = 500

// Every tab shares this sidecar, so two of them can aim at one destination before either clone has
// renamed anything into it — `existsSync` cannot see a clone that has not finished yet. Holding the
// path for the length of the operation makes the loser fail before it spawns git.
const claimedDestinations = new Set<string>()

// One directory can answer to several spellings: `Repo` and `repo` on Windows and macOS, and on a
// casefolded ext4 or a mounted NTFS share on Linux too; `café` written NFC and NFD on macOS; and
// `repo.` or `repo ` on Windows, where Win32 ignores what trails the final component. Which aliases
// a given filesystem honours cannot be known without writing to it, so the key folds all of them on
// every platform. The cost is that two clones of genuinely distinct names differing only in an
// alias are serialised on a disk that would have kept them apart; the alternative is two clones
// renaming into the same directory without ever having contested the claim.
export function destinationClaimKey(target: string): string {
  return target
    .normalize('NFC')
    .toLowerCase()
    .replace(/[. ]+$/, '')
}

function prepareTarget(request: CloneRequest): Effect.Effect<CloneTarget, GitError> {
  return Effect.suspend(() => {
    const url = request.url.trim()
    if (!isSupportedCloneUrl(url)) {
      return Effect.fail(new GitError({ message: INVALID_URL }))
    }
    const folderName = request.folderName.trim()
    if (!isSafeCloneFolderName(folderName)) {
      return Effect.fail(new GitError({ message: INVALID_FOLDER_NAME }))
    }
    const parentDir = resolveDirectoryWithinHome(request.parentDir)
    if (!parentDir) {
      return Effect.fail(new GitError({ message: INVALID_DESTINATION }))
    }
    const target = nodePath.join(parentDir, folderName)
    const claimKey = destinationClaimKey(target)
    // A clone in flight is reported as such rather than as a folder that already exists: "already
    // exists" would be misleading about a directory this operation is about to rename into place.
    // These steps run without interleaving, so the claim can never outlive a rejected request.
    if (claimedDestinations.has(claimKey)) {
      return Effect.fail(new GitError({ message: `${folderName} is already being cloned` }))
    }
    if (!isAvailableDestination(target)) {
      return Effect.fail(new GitError({ message: `${folderName} already exists in that folder` }))
    }
    claimedDestinations.add(claimKey)
    sweepOrphanedStaging(parentDir, folderName)
    const stagingPath = nodePath.join(
      parentDir,
      `${stagingPrefix(folderName)}${crypto.randomBytes(4).toString('hex')}`
    )
    try {
      fs.mkdirSync(stagingPath)
    } catch (error) {
      claimedDestinations.delete(claimKey)
      return Effect.fail(
        new GitError({ message: `cannot write to that folder: ${(error as Error).message}` })
      )
    }
    return Effect.succeed({ url, path: target, stagingPath, claimKey })
  })
}

// A sidecar that crashes mid-clone takes its sweep down with it, and nothing in-process survives to
// remember the staging directory it was writing. The full name pattern is ours alone — folder names
// starting with a dot are rejected up front — so whatever wears it, prefix and exact hex suffix
// both, is a dead clone's leavings. A near miss like `.repo.rebase-clone-backup` is somebody's own
// file and is left alone. Best effort: an orphaned git may still be holding files, and the clone
// about to start does not depend on this succeeding.
function sweepOrphanedStaging(parentDir: string, folderName: string): void {
  let entries: string[]
  try {
    entries = fs.readdirSync(parentDir)
  } catch {
    return
  }
  const prefix = stagingPrefix(folderName)
  for (const entry of entries) {
    if (entry.startsWith(prefix) && STAGING_SUFFIX.test(entry.slice(prefix.length))) {
      try {
        forceRemove(nodePath.join(parentDir, entry))
      } catch {}
    }
  }
}

// `git clone` is happy to write into a directory that already exists as long as it is empty, and
// holding a stricter line than git costs real users: people pre-create the folder they mean to
// clone into, and refusing it would block them on a directory with nothing in it. An empty
// destination is reclaimed at rename time rather than cloned into directly.
export function isAvailableDestination(target: string): boolean {
  try {
    return fs.readdirSync(target).length === 0
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT'
  }
}

// git writes its object and pack files read-only, and Windows refuses to unlink a read-only file.
// `force` only forgives a missing path, so the permission error survives every retry — the write bit
// has to come off first. On POSIX this is a no-op the directory already permits.
function clearReadOnly(entry: string): void {
  let stats: fs.Stats
  try {
    stats = fs.lstatSync(entry)
  } catch {
    return
  }
  // chmod follows symlinks, and a hostile repository can check one out pointing anywhere on the
  // machine. The link itself carries no permission that blocks its removal.
  if (stats.isSymbolicLink()) {
    return
  }
  try {
    fs.chmodSync(entry, stats.isDirectory() ? 0o700 : 0o600)
  } catch {}
  if (!stats.isDirectory()) {
    return
  }
  for (const child of fs.readdirSync(entry)) {
    clearReadOnly(nodePath.join(entry, child))
  }
}

export function forceRemove(target: string): void {
  try {
    fs.rmSync(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  } catch {
    clearReadOnly(target)
    fs.rmSync(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
}

// Windows will not let go of a directory a dying git still has open, so the sweep can lose that race
// however patiently it retries. It runs detached for that reason — the clone's own failure is
// already on its way to the UI and must not wait on housekeeping. A staging directory it fails to
// clear blocks nothing: no retry aims at its name, and the next attempt sweeps it again.
function sweepStagingDir(stagingPath: string): void {
  const deadline = Date.now() + CLEANUP_TIMEOUT_MS
  const attempt = () => {
    try {
      forceRemove(stagingPath)
    } catch {}
    if (!fs.existsSync(stagingPath) || Date.now() >= deadline) {
      return
    }
    setTimeout(attempt, CLEANUP_RETRY_MS).unref?.()
  }
  attempt()
}

// git has finished and exited by the time this runs, but Windows may still be touching the freshly
// written tree — an antivirus pass over new pack files is enough to make a directory rename fail
// once. The empty destination reclaimed here is the one `isAvailableDestination` accepted at the
// start; rmdir refuses anything that has since gained content, and the rename then reports it.
const PROMOTE_RETRIES = 10
const PROMOTE_RETRY_MS = 100

async function promoteClone(target: CloneTarget): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      fs.rmdirSync(target.path)
    } catch {}
    try {
      fs.renameSync(target.stagingPath, target.path)
      return
    } catch (error) {
      if (attempt >= PROMOTE_RETRIES) {
        throw error
      }
      await new Promise((resolve) => setTimeout(resolve, PROMOTE_RETRY_MS))
    }
  }
}

// Taking the process group down is best effort: a member that will not die must not hold the clone's
// own failure back from the UI, and the kill escalation inside terminate keeps running regardless.
async function terminateWithin(process: RunningGitProcess, timeoutMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const bound = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs)
    timer.unref?.()
  })
  try {
    await Promise.race([process.terminate(), bound])
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer)
    }
  }
}

function canonicalize(target: string): string {
  try {
    return fs.realpathSync.native(target)
  } catch {
    return target
  }
}

interface CloneState {
  succeeded: boolean
}

function progressStream(
  running: RunningGitProcess,
  target: CloneTarget,
  state: CloneState
): Stream.Stream<CloneProgress, GitError> {
  return Stream.asyncPush<CloneProgress, GitError>((emit) =>
    Effect.sync(() => {
      let buffer = ''
      let lastPhase = ''
      let lastPercent = -1

      // Live progress only. A git that exits before this listener attaches loses nothing that
      // matters: the outcome and the full stderr come from the promise below, which the spawn
      // helper wires up at spawn time and cannot miss.
      const stderr = running.child.stderr
      stderr?.setEncoding('utf8')
      stderr?.on('data', (chunk: string) => {
        buffer += chunk
        // git overwrites the current progress line with \r and starts a new phase with \n.
        const lines = buffer.split(/[\r\n]/)
        buffer = lines.pop() ?? ''
        const updates: CloneProgress[] = []
        for (const line of lines) {
          const parsed = parseCloneProgress(line)
          if (!parsed || (parsed.phase === lastPhase && parsed.percent === lastPercent)) {
            continue
          }
          lastPhase = parsed.phase
          lastPercent = parsed.percent
          updates.push({ ...parsed, done: false })
        }
        if (updates.length > 0) {
          emit.array(updates)
        }
      })

      running.result.then(
        async ({ code, stderr: collected }) => {
          if (code === 0) {
            try {
              await promoteClone(target)
            } catch (error) {
              emit.fail(
                new GitError({
                  message: `the clone finished, but its folder could not be moved into place: ${(error as Error).message}`
                })
              )
              return
            }
            state.succeeded = true
            emit.single({
              phase: 'Done',
              percent: 100,
              done: true,
              path: canonicalize(target.path)
            })
            emit.end()
            return
          }
          emit.fail(new GitError({ message: cloneFailureMessage(collected, code) }))
        },
        (error: Error) => emit.fail(new GitError({ message: error.message }))
      )
    })
  )
}

export function cloneRepo(request: CloneRequest): Stream.Stream<CloneProgress, GitError> {
  return Stream.unwrapScoped(
    Effect.gen(function* () {
      const state: CloneState = { succeeded: false }
      const target = yield* Effect.acquireRelease(prepareTarget(request), (claimed) =>
        // A failed clone leaves nothing at the destination — only staging, which no retry aims at —
        // so the claim can be let go the moment the operation is over, sweep still running or not.
        Effect.sync(() => claimedDestinations.delete(claimed.claimKey))
      )
      const running = yield* Effect.acquireRelease(
        Effect.sync(() =>
          startGit(['clone', '--progress', '--', target.url, target.stagingPath], {
            collectStdout: false,
            env: applyNonInteractiveGitEnv({ ...process.env })
          })
        ),
        (process) =>
          Effect.promise(async () => {
            await terminateWithin(process, TERMINATE_TIMEOUT_MS)
            if (!state.succeeded) {
              sweepStagingDir(target.stagingPath)
            }
          }).pipe(Effect.orDie)
      )
      return Stream.concat(
        Stream.succeed<CloneProgress>({ phase: 'Connecting', done: false }),
        progressStream(running, target, state)
      )
    })
  )
}
