import { type ChildProcessByStdio, spawn } from 'node:child_process'
import type { ServerResponse } from 'node:http'
import type { Readable } from 'node:stream'
import type { GitLogEntry, LogChunk } from '@shared/schemas/git'
import { Cause, Chunk, Effect, Fiber, Option, Stream } from 'effect'
import { LOG_FORMAT, parseGitLogRecord, RS_SEP } from './git/log-format'
import { GitError } from './git-errors'
import { capStderr } from './spawn'

export const STREAM_BATCH_SIZE = 500

export interface LogStreamOptions {
  skip?: number
  maxCount?: number
  streamId?: number
}

type GitStdioProc = ChildProcessByStdio<null, Readable, Readable>

function spawnGitLog(repoPath: string, options?: LogStreamOptions): GitStdioProc {
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
  if (typeof options?.maxCount === 'number' && options.maxCount > 0) {
    args.push(`--max-count=${options.maxCount}`)
  }
  if (typeof options?.skip === 'number' && options.skip > 0) {
    args.push(`--skip=${options.skip}`)
  }
  return spawn('git', args, { stdio: ['ignore', 'pipe', 'pipe'] })
}

function writeLine(res: ServerResponse, chunk: LogChunk): boolean {
  if (res.destroyed || res.writableEnded) {
    return false
  }
  return res.write(`${JSON.stringify(chunk)}\n`)
}

function waitForDrain(res: ServerResponse): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      res.off('drain', done)
      res.off('close', done)
      res.off('error', done)
      resolve()
    }
    res.once('drain', done)
    res.once('close', done)
    res.once('error', done)
  })
}

async function writeChunkWithBackpressure(
  res: ServerResponse,
  proc: GitStdioProc,
  chunk: LogChunk
): Promise<void> {
  const canContinue = writeLine(res, chunk)
  if (!canContinue && !res.destroyed && !res.writableEnded) {
    proc.stdout.pause()
    await waitForDrain(res)
    proc.stdout.resume()
  }
}

function writeTerminal(res: ServerResponse, chunk: LogChunk): void {
  if (res.destroyed || res.writableEnded) {
    return
  }
  res.write(`${JSON.stringify(chunk)}\n`)
  res.end()
}

// The parsed-record producer: a Stream whose lifetime is the spawned `git log`. NUL-delimited (-z)
// records are parsed and pushed; a nonzero exit fails the Stream, a clean exit ends it. The process
// is killed when the Stream's scope closes (completion, error, or interruption) — so a restart that
// interrupts this Stream can never leak the child or interleave with a fresh one.
//
// The buffer is intentionally unbounded: backpressure is applied by pausing `proc.stdout` on the
// write side (writeChunkWithBackpressure), not by the queue. Do NOT switch to a `dropping`/`sliding`
// strategy — that would silently drop commits.
function commitStream(proc: GitStdioProc): Stream.Stream<GitLogEntry, GitError> {
  return Stream.asyncPush<GitLogEntry, GitError>((emit) =>
    Effect.sync(() => {
      let buffer = ''
      let stderrBuf = ''

      proc.stdout.setEncoding('utf8')
      proc.stdout.on('data', (chunk: string) => {
        buffer += chunk
        const batch: GitLogEntry[] = []
        let idx = buffer.indexOf(RS_SEP)
        while (idx !== -1) {
          const record = buffer.slice(0, idx)
          buffer = buffer.slice(idx + 1)
          const parsed = parseGitLogRecord(record)
          if (parsed) {
            batch.push(parsed)
          }
          idx = buffer.indexOf(RS_SEP)
        }
        if (batch.length > 0) {
          emit.array(batch)
        }
      })

      proc.stderr.setEncoding('utf8')
      proc.stderr.on('data', (chunk: string) => {
        stderrBuf = capStderr(stderrBuf + chunk)
      })

      proc.on('error', (error) => {
        emit.fail(new GitError({ message: error.message }))
      })

      proc.on('close', (code) => {
        if (code !== 0 && code !== null) {
          emit.fail(
            new GitError({ message: stderrBuf.trim() || `git log exited with code ${code}` })
          )
        } else {
          emit.end()
        }
      })
    })
  )
}

export function streamGitLog(
  repoPath: string,
  res: ServerResponse,
  options?: LogStreamOptions
): void {
  res.writeHead(200, { 'content-type': 'application/x-ndjson' })
  const streamId = options?.streamId
  const pageSize = options?.maxCount

  const program = Effect.gen(function* () {
    const proc = yield* Effect.acquireRelease(
      Effect.sync(() => spawnGitLog(repoPath, options)),
      (child) =>
        Effect.sync(() => {
          if (!child.killed) {
            child.kill()
          }
        })
    )
    let totalEmitted = 0
    yield* commitStream(proc).pipe(
      Stream.grouped(STREAM_BATCH_SIZE),
      Stream.runForEach((group) => {
        const commits = Chunk.toReadonlyArray(group) as GitLogEntry[]
        totalEmitted += commits.length
        return Effect.promise(() =>
          writeChunkWithBackpressure(res, proc, { repoPath, commits, done: false, streamId })
        )
      })
    )
    return totalEmitted
  })

  const fiber = Effect.runFork(
    Effect.scoped(program).pipe(
      Effect.matchCauseEffect({
        onSuccess: (totalEmitted) =>
          Effect.sync(() => {
            const hasMore =
              typeof pageSize === 'number' && pageSize > 0 ? totalEmitted >= pageSize : false
            writeTerminal(res, { repoPath, commits: [], done: true, hasMore, streamId })
          }),
        onFailure: (cause) =>
          Effect.sync(() => {
            const failure = Cause.failureOption(cause)
            const error = Option.isSome(failure) ? failure.value.message : undefined
            writeTerminal(res, {
              repoPath,
              commits: [],
              done: true,
              hasMore: false,
              error,
              streamId
            })
          })
      })
    )
  )

  res.on('close', () => {
    void Effect.runPromise(Fiber.interrupt(fiber)).catch(() => {})
  })
}
