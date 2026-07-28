import fs from 'node:fs'
import nodePath from 'node:path'
import { isSafeCloneFolderName, isSupportedCloneUrl } from '@shared/clone-url'
import type { CloneProgress } from '@shared/schemas/git'
import { Effect, Stream } from 'effect'
import { promptlessEnv } from '../git/env'
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

interface CloneTarget {
  url: string
  path: string
  claimKey: string
}

// A clone that is torn down while git is still connecting can take a moment to bring the process
// group down, and the failure it is holding up is on its way to the UI. The force-kill inside
// terminate lands well before this, so reaching the bound means something is stuck, not slow.
const TERMINATE_TIMEOUT_MS = 5_000

// How long the destination sweep keeps trying, and how often. Long enough to outlast a git that is
// slow to let go on Windows, short enough that it cannot outlive the tab that started the clone.
const CLEANUP_TIMEOUT_MS = 30_000
const CLEANUP_RETRY_MS = 250

// Every tab shares this sidecar, so two of them can aim at one destination before either git child
// creates it — `existsSync` cannot see a clone that has not written anything yet. Holding the path
// for the length of the operation makes the loser fail before it spawns git, which is also what
// makes the cleanup below safe: a running clone owns its directory outright.
const claimedDestinations = new Set<string>()

// Windows and macOS default to case-insensitive filesystems, where `Repo` and `repo` name one
// directory but two different strings. Folding them together keeps two tabs from both believing
// they own the destination — and so from one of them deleting the other's clone on the way out.
const CASE_INSENSITIVE_FILESYSTEM = process.platform === 'win32' || process.platform === 'darwin'

export function destinationClaimKey(
  target: string,
  caseInsensitive: boolean = CASE_INSENSITIVE_FILESYSTEM
): string {
  return caseInsensitive ? target.toLowerCase() : target
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
    // A clone in flight is reported as such rather than as a folder that already exists: by the time
    // git has created the directory, "already exists" would be true but misleading. These three
    // steps run without interleaving, so the claim can never outlive a rejected request.
    if (claimedDestinations.has(claimKey)) {
      return Effect.fail(new GitError({ message: `${folderName} is already being cloned` }))
    }
    if (!isAvailableDestination(target)) {
      return Effect.fail(new GitError({ message: `${folderName} already exists in that folder` }))
    }
    claimedDestinations.add(claimKey)
    return Effect.succeed({ url, path: target, claimKey })
  })
}

// `git clone` is happy to write into a directory that already exists as long as it is empty, and
// holding a stricter line than git costs real users: a clone killed part-way can leave its empty
// destination behind — Windows will not release a directory a dying git still has open — and
// refusing it would block every retry on a folder with nothing in it.
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

// A clone that dies part-way leaves a half-written tree behind. We only ever remove a path we
// checked was absent before starting and have held the claim on since — and even then only if it
// still looks like git's own work: the repository it was writing, or the bare directory it creates
// before writing anything. An interrupt that lands in that opening moment would otherwise leave an
// empty folder sitting on the destination, blocking every retry with "already exists".
export function removePartialClone(target: string): void {
  try {
    const looksLikeGitsOwnWork =
      fs.existsSync(nodePath.join(target, '.git')) || fs.readdirSync(target).length === 0
    if (!looksLikeGitsOwnWork) {
      return
    }
    try {
      fs.rmSync(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    } catch {
      clearReadOnly(target)
      fs.rmSync(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    }
  } catch {}
}

// Windows will not let go of a directory a dying git still has open, so the sweep can lose that race
// however patiently it retries. It runs detached for that reason: the clone's own failure is already
// on its way to the UI and must not wait on housekeeping, and a destination that outlives the sweep
// is left empty — which the next attempt is free to clone into.
function sweepPartialClone(target: string): void {
  const deadline = Date.now() + CLEANUP_TIMEOUT_MS
  const attempt = () => {
    removePartialClone(target)
    if (!fs.existsSync(target) || Date.now() >= deadline) {
      return
    }
    setTimeout(attempt, CLEANUP_RETRY_MS).unref?.()
  }
  attempt()
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
  target: string,
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
        ({ code, stderr: collected }) => {
          if (code === 0) {
            state.succeeded = true
            emit.single({ phase: 'Done', percent: 100, done: true, path: canonicalize(target) })
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
      const target = yield* Effect.acquireRelease(prepareTarget(request), (claimed) =>
        Effect.sync(() => claimedDestinations.delete(claimed.claimKey))
      )
      const state: CloneState = { succeeded: false }
      const running = yield* Effect.acquireRelease(
        Effect.sync(() =>
          startGit(['clone', '--progress', '--', target.url, target.path], {
            collectStdout: false,
            env: promptlessEnv()
          })
        ),
        (process) =>
          Effect.promise(async () => {
            await terminateWithin(process, TERMINATE_TIMEOUT_MS)
            if (!state.succeeded) {
              sweepPartialClone(target.path)
            }
          }).pipe(Effect.orDie)
      )
      return Stream.concat(
        Stream.succeed<CloneProgress>({ phase: 'Connecting', done: false }),
        progressStream(running, target.path, state)
      )
    })
  )
}
