import fs from 'node:fs'
import nodePath from 'node:path'
import { isSafeCloneFolderName, isSupportedCloneUrl } from '@shared/clone-url'
import type { CloneProgress } from '@shared/schemas/git'
import { Effect, Stream } from 'effect'
import { promptlessEnv } from '../git/env'
import { GitError } from '../git/errors'
import { resolveDirectoryWithinHome } from '../git/path-guards'
import { capStderr, type RunningGitProcess, startGit } from '../git/spawn'

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
    if (fs.existsSync(target)) {
      return Effect.fail(new GitError({ message: `${folderName} already exists in that folder` }))
    }
    return Effect.succeed({ url, path: target })
  })
}

// A clone that dies part-way leaves a half-written tree behind. We only ever remove a path we
// checked was absent before starting, and only while it still looks like the clone git created.
function removePartialClone(target: string): void {
  try {
    if (!fs.existsSync(nodePath.join(target, '.git'))) {
      return
    }
    fs.rmSync(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
  } catch {}
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
      let stderrBuffer = ''
      let lastPhase = ''
      let lastPercent = -1

      const stderr = running.child.stderr
      stderr?.setEncoding('utf8')
      stderr?.on('data', (chunk: string) => {
        stderrBuffer = capStderr(stderrBuffer + chunk)
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

      running.child.once('error', (error: Error) => {
        emit.fail(new GitError({ message: error.message }))
      })

      running.child.once('close', (code: number | null) => {
        if (code === 0) {
          state.succeeded = true
          emit.single({ phase: 'Done', percent: 100, done: true, path: canonicalize(target) })
          emit.end()
          return
        }
        emit.fail(new GitError({ message: cloneFailureMessage(stderrBuffer, code) }))
      })
    })
  )
}

export function cloneRepo(request: CloneRequest): Stream.Stream<CloneProgress, GitError> {
  return Stream.unwrapScoped(
    Effect.gen(function* () {
      const target = yield* prepareTarget(request)
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
            await process.terminate()
            if (!state.succeeded) {
              removePartialClone(target.path)
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
