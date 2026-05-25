import { spawn } from 'node:child_process'
import { encodeOrThrow } from '@shared/codec'
import { normalizeRepoPath } from '@shared/repo-path'
import type { GitLogEntry, LogChunk } from '@shared/schemas/git'
import { CancelLogStreamResponse, Channel, StartLogStreamResponse } from '@shared/schemas/ipc'
import { ipcMain, webContents as webContentsApi } from 'electron'

const FS_SEP = '\x1F'
const RS_SEP = '\x00'
const STREAM_FORMAT = ['%H', '%P', '%aI', '%aN', '%s', '%D'].join(FS_SEP)
const STREAM_BATCH_SIZE = 500

interface ActiveStream {
  proc: ReturnType<typeof spawn>
  finishOk: () => void
  webContentsId: number
  repoPath: string
}

const activeLogStreams = new Map<string, ActiveStream>()
const webContentsCleanupBound = new Set<number>()

function streamKey(webContentsId: number, repoPath: string): string {
  return `${webContentsId}:${repoPath}`
}

function killActiveStream(webContentsId: number, repoPath: string): void {
  const key = streamKey(webContentsId, repoPath)
  const existing = activeLogStreams.get(key)
  if (!existing) return
  activeLogStreams.delete(key)
  if (!existing.proc.killed) existing.proc.kill()
  existing.finishOk()
}

function killAllStreamsForWebContents(webContentsId: number): void {
  for (const [key, stream] of activeLogStreams) {
    if (stream.webContentsId !== webContentsId) continue
    activeLogStreams.delete(key)
    if (!stream.proc.killed) stream.proc.kill()
    stream.finishOk()
  }
}

function bindWebContentsCleanup(webContentsId: number): void {
  if (webContentsCleanupBound.has(webContentsId)) return
  webContentsCleanupBound.add(webContentsId)
  const contents = webContentsApi.fromId(webContentsId)
  if (!contents) {
    webContentsCleanupBound.delete(webContentsId)
    return
  }
  contents.once('destroyed', () => {
    killAllStreamsForWebContents(webContentsId)
    webContentsCleanupBound.delete(webContentsId)
  })
}

export function register(): void {
  ipcMain.handle(Channel.startLogStream, async (event, repoPath: string) => {
    const key = normalizeRepoPath(repoPath)
    const webContents = event.sender
    const webContentsId = webContents.id

    killActiveStream(webContentsId, key)
    bindWebContentsCleanup(webContentsId)

    return new Promise<typeof StartLogStreamResponse.Encoded>((resolve) => {
      let resolved = false
      const finishOk = () => {
        if (resolved) return
        resolved = true
        resolve(encodeOrThrow(StartLogStreamResponse, { _tag: 'Ok' }))
      }
      const finishErr = (message: string) => {
        if (resolved) return
        resolved = true
        resolve(encodeOrThrow(StartLogStreamResponse, { _tag: 'GitError', message }))
      }

      const proc = spawn(
        'git',
        [
          '-C',
          key,
          'log',
          '-z',
          '--branches',
          '--remotes',
          '--date-order',
          `--format=${STREAM_FORMAT}`
        ],
        { stdio: ['ignore', 'pipe', 'pipe'] }
      )
      const mapKey = streamKey(webContentsId, key)
      activeLogStreams.set(mapKey, { proc, finishOk, webContentsId, repoPath: key })

      finishOk()

      let buffer = ''
      let batch: GitLogEntry[] = []

      const send = (done: boolean) => {
        if (webContents.isDestroyed()) return
        if (batch.length === 0 && !done) return
        const chunk: LogChunk = { repoPath: key, commits: batch, done }
        webContents.send(Channel.logChunk, chunk)
        batch = []
      }

      proc.stdout?.setEncoding('utf8')
      proc.stdout?.on('data', (chunk: string) => {
        buffer += chunk
        let idx = buffer.indexOf(RS_SEP)
        while (idx !== -1) {
          const record = buffer.slice(0, idx)
          buffer = buffer.slice(idx + 1)
          if (record) {
            const fields = record.split(FS_SEP)
            if (fields.length >= 6) {
              const [hash, parentsStr, date, author_name, message, refs] = fields
              batch.push({
                hash,
                message: message ?? '',
                author_name: author_name ?? '',
                date: date ?? '',
                parents: parentsStr ? parentsStr.split(' ').filter(Boolean) : [],
                refs: refs ?? ''
              })
              if (batch.length >= STREAM_BATCH_SIZE) send(false)
            }
          }
          idx = buffer.indexOf(RS_SEP)
        }
      })

      let stderrBuf = ''
      proc.stderr?.setEncoding('utf8')
      proc.stderr?.on('data', (chunk: string) => {
        stderrBuf += chunk
        if (stderrBuf.length > 4096) stderrBuf = stderrBuf.slice(-4096)
      })

      proc.on('error', (err) => {
        const current = activeLogStreams.get(mapKey)
        if (current?.proc !== proc) return
        activeLogStreams.delete(mapKey)
        if (!webContents.isDestroyed()) {
          const chunk: LogChunk = {
            repoPath: key,
            commits: [],
            done: true,
            error: err.message
          }
          webContents.send(Channel.logChunk, chunk)
        }
        finishErr(err.message)
      })

      proc.on('close', (code) => {
        const current = activeLogStreams.get(mapKey)
        if (current?.proc !== proc) return
        activeLogStreams.delete(mapKey)

        if (code !== 0 && code !== null) {
          const message = stderrBuf.trim() || `git log exited with code ${code}`
          if (!webContents.isDestroyed()) {
            const chunk: LogChunk = { repoPath: key, commits: [], done: true, error: message }
            webContents.send(Channel.logChunk, chunk)
          }
          finishErr(message)
          return
        }

        send(false)
        if (!webContents.isDestroyed()) {
          const chunk: LogChunk = { repoPath: key, commits: [], done: true }
          webContents.send(Channel.logChunk, chunk)
        }
        finishOk()
      })
    })
  })

  ipcMain.handle(Channel.cancelLogStream, (event, repoPath: string) => {
    if (repoPath) {
      killActiveStream(event.sender.id, normalizeRepoPath(repoPath))
    } else {
      killAllStreamsForWebContents(event.sender.id)
    }
    return encodeOrThrow(CancelLogStreamResponse, {})
  })
}
