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

const PROGRESS_LINE = /^(?:remote:\s*)?([A-Za-z][A-Za-z0-9 ]*?):\s+(\d{1,3})%/

export function parseCloneProgress(line: string): { phase: string; percent: number } | null {
  const match = PROGRESS_LINE.exec(line.trim())
  if (!match) {
    return null
  }
  const percent = Number(match[2])
  return percent >= 0 && percent <= 100 ? { phase: match[1], percent } : null
}

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
  stagingPath: string
  claimKey: string
}

const stagingPrefix = (folderName: string): string => `.${folderName}.rebase-clone-`
const STAGING_SUFFIX = /^[0-9a-f]{8}$/

export function isCloneStagingName(name: string): boolean {
  return /^\..+\.rebase-clone-[0-9a-f]{8}$/.test(name)
}

const TERMINATE_TIMEOUT_MS = 5_000

const CLEANUP_TIMEOUT_MS = 5_000
const CLEANUP_RETRY_MS = 500

const claimedDestinations = new Set<string>()

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
    if (claimedDestinations.has(claimKey)) {
      return Effect.fail(new GitError({ message: `${folderName} is already being cloned` }))
    }
    if (!isAvailableDestination(target)) {
      return Effect.fail(new GitError({ message: `${folderName} already exists in that folder` }))
    }
    claimedDestinations.add(claimKey)
    const stagingName = `${stagingPrefix(folderName)}${crypto.randomBytes(4).toString('hex')}`
    const stagingPath = nodePath.join(parentDir, stagingName)
    try {
      fs.mkdirSync(stagingPath)
    } catch (error) {
      claimedDestinations.delete(claimKey)
      return Effect.fail(
        new GitError({ message: `cannot write to that folder: ${(error as Error).message}` })
      )
    }
    sweepOrphanedStaging(parentDir, folderName, stagingName)
    return Effect.succeed({ url, path: target, stagingPath, claimKey })
  })
}

function sweepOrphanedStaging(parentDir: string, folderName: string, ownStagingName: string): void {
  const prefix = stagingPrefix(folderName)
  void fs.promises
    .readdir(parentDir)
    .then(async (entries) => {
      for (const entry of entries) {
        if (
          entry !== ownStagingName &&
          entry.startsWith(prefix) &&
          STAGING_SUFFIX.test(entry.slice(prefix.length))
        ) {
          try {
            await forceRemove(nodePath.join(parentDir, entry))
          } catch {}
        }
      }
    })
    .catch(() => {})
}

export function isAvailableDestination(target: string): boolean {
  try {
    return fs.readdirSync(target).length === 0
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT'
  }
}

async function clearReadOnly(entry: string): Promise<void> {
  let stats: fs.Stats
  try {
    stats = await fs.promises.lstat(entry)
  } catch {
    return
  }
  if (stats.isSymbolicLink()) {
    return
  }
  try {
    await fs.promises.chmod(entry, stats.isDirectory() ? 0o700 : 0o600)
  } catch {}
  if (!stats.isDirectory()) {
    return
  }
  let children: string[]
  try {
    children = await fs.promises.readdir(entry)
  } catch {
    return
  }
  for (const child of children) {
    await clearReadOnly(nodePath.join(entry, child))
  }
}

export async function forceRemove(target: string): Promise<void> {
  try {
    await fs.promises.rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  } catch {
    await clearReadOnly(target)
    await fs.promises.rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
}

function sweepStagingDir(stagingPath: string): void {
  const deadline = Date.now() + CLEANUP_TIMEOUT_MS
  const attempt = async () => {
    try {
      await forceRemove(stagingPath)
    } catch {}
    if (!fs.existsSync(stagingPath) || Date.now() >= deadline) {
      return
    }
    setTimeout(attempt, CLEANUP_RETRY_MS).unref?.()
  }
  void attempt()
}

const PROMOTE_RETRIES = 25
const PROMOTE_RETRY_MS = 200

export async function promoteClone(stagingPath: string, destination: string): Promise<void> {
  let removedBorrowedDirectory = false
  for (let attempt = 1; ; attempt++) {
    try {
      fs.rmdirSync(destination)
      removedBorrowedDirectory = true
    } catch {}
    try {
      fs.renameSync(stagingPath, destination)
      return
    } catch (error) {
      if (attempt >= PROMOTE_RETRIES) {
        if (removedBorrowedDirectory) {
          try {
            fs.mkdirSync(destination)
          } catch {}
        }
        throw error
      }
      await new Promise((resolve) => setTimeout(resolve, PROMOTE_RETRY_MS))
    }
  }
}

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

      const stderr = running.child.stderr
      stderr?.setEncoding('utf8')
      stderr?.on('data', (chunk: string) => {
        buffer += chunk
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
              await promoteClone(target.stagingPath, target.path)
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
