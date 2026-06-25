import { type ChildProcessByStdio, spawn } from 'node:child_process'
import type { Readable } from 'node:stream'
import type { GitLogEntry, LogChunk } from '@shared/schemas/git'
import { Chunk, Effect, Ref, Stream } from 'effect'
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

// The parsed-record producer: a Stream whose lifetime is the spawned `git log`. NUL-delimited (-z)
// records are parsed and pushed; a nonzero exit fails the Stream, a clean exit ends it. The process
// is killed when the Stream's scope closes (completion, error, or interruption) — so a restart that
// interrupts this Stream can never leak the child or interleave with a fresh one.
//
// The buffer is intentionally unbounded so commits are never dropped (do NOT switch to a
// `dropping`/`sliding` strategy). The sole consumer is the main process draining the loopback socket,
// which keeps up with `git log`, so the queue stays shallow in practice.
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

// The streaming-RPC producer: the same `git log` history modeled as a Stream of LogChunks instead of
// written onto a ServerResponse. The terminal `done` chunk carries `hasMore` (pagination) exactly as
// the dedicated endpoint did; stream errors flow through the GitError channel. The spawned child is
// killed when the stream's scope closes (completion, error, or interruption), so a superseded stream
// never leaks the child.
export function logChunkStream(
  repoPath: string,
  options?: LogStreamOptions
): Stream.Stream<LogChunk, GitError> {
  const streamId = options?.streamId
  const pageSize = options?.maxCount
  return Stream.unwrapScoped(
    Effect.gen(function* () {
      const proc = yield* Effect.acquireRelease(
        Effect.sync(() => spawnGitLog(repoPath, options)),
        (child) =>
          Effect.sync(() => {
            if (!child.killed) {
              child.kill()
            }
          })
      )
      const emitted = yield* Ref.make(0)
      const data = commitStream(proc).pipe(
        Stream.grouped(STREAM_BATCH_SIZE),
        Stream.mapEffect((group) => {
          const commits = Chunk.toReadonlyArray(group) as GitLogEntry[]
          return Ref.update(emitted, (total) => total + commits.length).pipe(
            Effect.as<LogChunk>({ repoPath, commits, done: false, streamId })
          )
        })
      )
      const terminal = Stream.fromEffect(
        Ref.get(emitted).pipe(
          Effect.map((total): LogChunk => {
            const hasMore = typeof pageSize === 'number' && pageSize > 0 ? total >= pageSize : false
            return { repoPath, commits: [], done: true, hasMore, streamId }
          })
        )
      )
      return Stream.concat(data, terminal)
    })
  )
}
