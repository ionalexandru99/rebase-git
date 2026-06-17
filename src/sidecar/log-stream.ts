import { spawn } from 'node:child_process'
import type { ServerResponse } from 'node:http'
import type { GitLogEntry, LogChunk } from '@shared/schemas/git'
import { LOG_FORMAT, parseGitLogRecord, RS_SEP } from './git/log-format'

export const STREAM_BATCH_SIZE = 500

export interface LogStreamOptions {
  skip?: number
  maxCount?: number
  streamId?: number
}

function writeChunk(res: ServerResponse, chunk: LogChunk): boolean {
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

export function streamGitLog(
  repoPath: string,
  res: ServerResponse,
  options?: LogStreamOptions
): void {
  res.writeHead(200, { 'content-type': 'application/x-ndjson' })

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

  const proc = spawn('git', args, { stdio: ['ignore', 'pipe', 'pipe'] })

  let finished = false
  let buffer = ''
  let batch: GitLogEntry[] = []
  let stderrBuf = ''
  let pendingWrite = Promise.resolve()
  let totalEmitted = 0
  const pageSize = options?.maxCount
  const streamId = options?.streamId

  const send = (done: boolean, error?: string) => {
    if (batch.length === 0 && !done && !error) {
      return
    }
    const commits = batch
    batch = []
    totalEmitted += commits.length
    pendingWrite = pendingWrite.then(async () => {
      const canContinue = writeChunk(res, { repoPath, commits, done, error, streamId })
      if (!canContinue && !res.destroyed && !res.writableEnded) {
        proc.stdout?.pause()
        await waitForDrain(res)
        proc.stdout?.resume()
      }
    })
  }

  const finish = async (error?: string) => {
    if (finished) {
      return
    }
    finished = true
    send(false)
    await pendingWrite
    const hasMore = typeof pageSize === 'number' && pageSize > 0 ? totalEmitted >= pageSize : false
    writeChunk(res, { repoPath, commits: [], done: true, hasMore, error, streamId })
    res.end()
  }

  res.on('close', () => {
    if (finished) {
      return
    }
    finished = true
    if (!proc.killed) {
      proc.kill()
    }
  })

  proc.stdout?.setEncoding('utf8')
  proc.stdout?.on('data', (chunk: string) => {
    buffer += chunk
    let idx = buffer.indexOf(RS_SEP)
    while (idx !== -1) {
      const record = buffer.slice(0, idx)
      buffer = buffer.slice(idx + 1)
      const parsed = parseGitLogRecord(record)
      if (parsed) {
        batch.push(parsed)
        if (batch.length >= STREAM_BATCH_SIZE) {
          send(false)
        }
      }
      idx = buffer.indexOf(RS_SEP)
    }
  })

  proc.stderr?.setEncoding('utf8')
  proc.stderr?.on('data', (chunk: string) => {
    stderrBuf += chunk
    if (stderrBuf.length > 4096) {
      stderrBuf = stderrBuf.slice(-4096)
    }
  })

  proc.on('error', (error) => {
    void finish(error.message)
  })

  proc.on('close', (code) => {
    if (finished) {
      return
    }
    if (code !== 0 && code !== null) {
      void finish(stderrBuf.trim() || `git log exited with code ${code}`)
      return
    }
    void finish()
  })
}
