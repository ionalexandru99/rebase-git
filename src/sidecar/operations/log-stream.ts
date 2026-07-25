import type { ChildProcessByStdio } from 'node:child_process'
import type { Readable } from 'node:stream'
import type { GitLogEntry, LogChunk } from '@shared/schemas/git'
import { Context, Effect, Layer, ManagedRuntime, Stream } from 'effect'
import { GitError } from '../git/errors'
import { LOG_FORMAT, parseGitLogRecord, RS_SEP } from '../git/log-format'
import {
  attachRequestChild,
  capStderr,
  detachRequestChild,
  type RunningGitProcess,
  startGit
} from '../git/spawn'

export const STREAM_BATCH_SIZE = 500

export interface LogStreamOptions {
  skip?: number
  maxCount?: number
  streamId?: number
}

type GitStdioProc = ChildProcessByStdio<null, Readable, Readable>

interface LogContinuation {
  repoPath: string
  offset: number
  running: RunningGitProcess
  iterator: AsyncIterator<string | Buffer>
  buffer: string
  lookahead: GitLogEntry | undefined
  done: boolean
}

interface LogPage {
  commits: GitLogEntry[]
  hasMore: boolean
}

function gitError(error: unknown): GitError {
  return error instanceof GitError ? error : new GitError({ message: String(error) })
}

function startGitLog(repoPath: string): RunningGitProcess {
  return startGit(
    [
      '-C',
      repoPath,
      'log',
      '-z',
      '--ignore-missing',
      '--topo-order',
      `--format=${LOG_FORMAT}`,
      'HEAD',
      '--branches',
      '--remotes',
      '--tags'
    ],
    { collectStdout: false, pipeStdout: true }
  )
}

function commitStream(proc: GitStdioProc): Stream.Stream<GitLogEntry, GitError> {
  return Stream.asyncPush<GitLogEntry, GitError>((emit) =>
    Effect.sync(() => {
      let buffer = ''
      let stderrBuffer = ''

      proc.stdout.setEncoding('utf8')
      proc.stdout.on('data', (chunk: string) => {
        buffer += chunk
        const batch: GitLogEntry[] = []
        let index = buffer.indexOf(RS_SEP)
        while (index !== -1) {
          const record = buffer.slice(0, index)
          buffer = buffer.slice(index + 1)
          const parsed = parseGitLogRecord(record)
          if (parsed) {
            batch.push(parsed)
          }
          index = buffer.indexOf(RS_SEP)
        }
        if (batch.length > 0) {
          emit.array(batch)
        }
      })

      proc.stderr.setEncoding('utf8')
      proc.stderr.on('data', (chunk: string) => {
        stderrBuffer = capStderr(stderrBuffer + chunk)
      })

      proc.on('error', (error) => {
        emit.fail(new GitError({ message: error.message }))
      })

      proc.on('close', (code) => {
        if (code !== 0 && code !== null) {
          emit.fail(
            new GitError({ message: stderrBuffer.trim() || `git log exited with code ${code}` })
          )
        } else {
          emit.end()
        }
      })
    })
  )
}

function createContinuation(repoPath: string): LogContinuation {
  const running = startGitLog(repoPath)
  const stdout = running.child.stdout as Readable
  stdout.setEncoding('utf8')
  return {
    repoPath,
    offset: 0,
    running,
    iterator: stdout[Symbol.asyncIterator]() as AsyncIterator<string | Buffer>,
    buffer: '',
    lookahead: undefined,
    done: false
  }
}

async function nextCommit(continuation: LogContinuation): Promise<GitLogEntry | undefined> {
  if (continuation.lookahead) {
    const commit = continuation.lookahead
    continuation.lookahead = undefined
    return commit
  }

  while (true) {
    const separator = continuation.buffer.indexOf(RS_SEP)
    if (separator !== -1) {
      const record = continuation.buffer.slice(0, separator)
      continuation.buffer = continuation.buffer.slice(separator + 1)
      const commit = parseGitLogRecord(record)
      if (commit) {
        return commit
      }
      continue
    }
    if (continuation.done) {
      return undefined
    }
    const chunk = await continuation.iterator.next()
    if (!chunk.done) {
      continuation.buffer += chunk.value.toString()
      continue
    }
    continuation.done = true
    const { code, stderr } = await continuation.running.result
    if (code !== 0 && code !== null) {
      throw new GitError({ message: stderr.trim() || `git log exited with code ${code}` })
    }
    const commit = parseGitLogRecord(continuation.buffer)
    continuation.buffer = ''
    if (commit) {
      return commit
    }
  }
}

async function readPage(
  continuation: LogContinuation,
  skip: number,
  limit: number
): Promise<LogPage> {
  while (continuation.offset < skip) {
    const discarded = await nextCommit(continuation)
    if (!discarded) {
      return { commits: [], hasMore: false }
    }
    continuation.offset += 1
  }

  const commits: GitLogEntry[] = []
  while (commits.length < limit) {
    const commit = await nextCommit(continuation)
    if (!commit) {
      return { commits, hasMore: false }
    }
    commits.push(commit)
    continuation.offset += 1
  }

  continuation.lookahead = await nextCommit(continuation)
  return { commits, hasMore: continuation.lookahead !== undefined }
}

export interface LogContinuationsService {
  clear(repoPath: string): Promise<void>
  loadPage(repoPath: string, skip: number, limit: number, signal: AbortSignal): Promise<LogPage>
}

interface ManagedLogContinuations extends LogContinuationsService {
  close(): Promise<void>
}

function makeLogContinuations(): ManagedLogContinuations {
  const continuations = new Map<string, LogContinuation>()

  const finish = async (continuation: LogContinuation): Promise<void> => {
    if (continuations.get(continuation.repoPath) === continuation) {
      continuations.delete(continuation.repoPath)
    }
    if (!continuation.done) {
      await continuation.running.terminate()
    }
  }

  const clear = async (repoPath: string): Promise<void> => {
    const continuation = continuations.get(repoPath)
    if (continuation) {
      await finish(continuation)
    }
  }

  return {
    clear,
    loadPage: async (repoPath, skip, limit, signal) => {
      let continuation = continuations.get(repoPath)
      if (skip === 0 || !continuation || continuation.offset !== skip) {
        if (continuation) {
          await finish(continuation)
        }
        continuation = createContinuation(repoPath)
        continuations.set(repoPath, continuation)
      } else {
        attachRequestChild(continuation.running.child)
      }

      const abort = () => {
        void finish(continuation)
      }
      signal.addEventListener('abort', abort, { once: true })
      try {
        const page = await readPage(continuation, skip, limit)
        detachRequestChild(continuation.running.child)
        return page
      } catch (error) {
        await finish(continuation)
        throw error
      } finally {
        signal.removeEventListener('abort', abort)
      }
    },
    close: async () => {
      await Promise.all([...continuations.values()].map(finish))
    }
  }
}

export class LogContinuations extends Context.Tag('sidecar/LogContinuations')<
  LogContinuations,
  LogContinuationsService
>() {}

export const LogContinuationsLive = Layer.scoped(
  LogContinuations,
  Effect.acquireRelease(Effect.sync(makeLogContinuations), (registry) =>
    Effect.promise(() => registry.close())
  )
)

const logContinuationsRuntime = ManagedRuntime.make(LogContinuationsLive)

function withLogContinuations<T>(
  use: (registry: LogContinuationsService) => Promise<T>
): Promise<T> {
  return logContinuationsRuntime.runPromise(
    LogContinuations.pipe(Effect.flatMap((registry) => Effect.promise(() => use(registry))))
  )
}

export function clearLogContinuation(repoPath: string): Promise<void> {
  return withLogContinuations((registry) => registry.clear(repoPath))
}

function loadPage(
  repoPath: string,
  skip: number,
  limit: number,
  signal: AbortSignal
): Promise<LogPage> {
  return withLogContinuations((registry) => registry.loadPage(repoPath, skip, limit, signal))
}

export function finalizeLogContinuations(): Promise<void> {
  return logContinuationsRuntime.dispose()
}

function pageStream(
  repoPath: string,
  page: LogPage,
  streamId: number | undefined
): Stream.Stream<LogChunk> {
  const chunks: LogChunk[] = []
  for (let index = 0; index < page.commits.length; index += STREAM_BATCH_SIZE) {
    chunks.push({
      repoPath,
      commits: page.commits.slice(index, index + STREAM_BATCH_SIZE),
      done: false,
      streamId
    })
  }
  chunks.push({
    repoPath,
    commits: [],
    done: true,
    hasMore: page.hasMore,
    streamId
  })
  return Stream.fromIterable(chunks)
}

export function logChunkStream(
  repoPath: string,
  options?: LogStreamOptions
): Stream.Stream<LogChunk, GitError> {
  const streamId = options?.streamId
  const limit = options?.maxCount
  const skip = options?.skip ?? 0
  if (limit !== undefined) {
    return Stream.unwrap(
      Effect.tryPromise({
        try: (signal) => loadPage(repoPath, skip, limit, signal),
        catch: gitError
      }).pipe(Effect.map((page) => pageStream(repoPath, page, streamId)))
    )
  }

  return Stream.unwrapScoped(
    Effect.gen(function* () {
      yield* Effect.tryPromise({
        try: () => clearLogContinuation(repoPath),
        catch: gitError
      })
      const running = yield* Effect.acquireRelease(
        Effect.sync(() => startGitLog(repoPath)),
        (process) => Effect.promise(() => process.terminate()).pipe(Effect.orDie)
      )
      const data = commitStream(running.child as GitStdioProc).pipe(
        Stream.drop(skip),
        Stream.grouped(STREAM_BATCH_SIZE),
        Stream.map(
          (group): LogChunk => ({
            repoPath,
            commits: Array.from(group),
            done: false,
            streamId
          })
        )
      )
      return Stream.concat(
        data,
        Stream.succeed({
          repoPath,
          commits: [],
          done: true,
          hasMore: false,
          streamId
        })
      )
    })
  )
}
