import { spawn } from 'node:child_process'
import { encodeOrThrow } from '@shared/codec'
import type { LogChunk } from '@shared/schemas/git'
import { CancelLogStreamResponse, Channel, StartLogStreamResponse } from '@shared/schemas/ipc'
import { ipcMain } from 'electron'
import { normalizeRepoPath } from '../git/instances'
import type { SerializableLogEntry } from '../git/serialize'

const FS_SEP = '\x1F'
const RS_SEP = '\x00'
const STREAM_FORMAT = ['%H', '%P', '%aI', '%aN', '%s', '%D'].join(FS_SEP)
const STREAM_BATCH_SIZE = 500

interface ActiveStream {
  proc: ReturnType<typeof spawn>
  finishOk: () => void
  repoPath: string
}

const activeLogStreams = new Map<number, ActiveStream>()

function killActiveStream(webContentsId: number): void {
  const existing = activeLogStreams.get(webContentsId)
  if (!existing) return
  activeLogStreams.delete(webContentsId)
  if (!existing.proc.killed) existing.proc.kill()
  // Resolve the previous IPC reply so electron doesn't log
  // "Error invoking remote method 'start-log-stream': reply was never sent".
  existing.finishOk()
}

export function register(): void {
  ipcMain.handle(Channel.startLogStream, async (event, repoPath: string) => {
    const key = normalizeRepoPath(repoPath)
    const webContents = event.sender
    const webContentsId = webContents.id

    const existing = activeLogStreams.get(webContentsId)
    if (existing && existing.repoPath !== key && !webContents.isDestroyed()) {
      // The previous stream was for a different repo (e.g. another tab in the
      // same window). Emit a synthetic done so that tab's listener clears its
      // logLoading state — without it the spinner is stuck forever.
      const orphanDone: LogChunk = { repoPath: existing.repoPath, commits: [], done: true }
      webContents.send(Channel.logChunk, orphanDone)
    }
    killActiveStream(webContentsId)

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
      activeLogStreams.set(webContentsId, { proc, finishOk, repoPath: key })

      let buffer = ''
      let batch: SerializableLogEntry[] = []

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
        const current = activeLogStreams.get(webContentsId)
        if (current?.proc !== proc) {
          // killActiveStream already resolved the reply; nothing more to do.
          return
        }
        activeLogStreams.delete(webContentsId)
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
        const current = activeLogStreams.get(webContentsId)
        if (current?.proc !== proc) {
          // killActiveStream already resolved the reply; do not emit a stale
          // done chunk that would flip the renderer's logLoading off for the
          // new stream.
          return
        }
        activeLogStreams.delete(webContentsId)

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

  ipcMain.handle(Channel.cancelLogStream, (event) => {
    killActiveStream(event.sender.id)
    return encodeOrThrow(CancelLogStreamResponse, {})
  })
}
