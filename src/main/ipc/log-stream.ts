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

const activeLogStreams = new Map<number, ReturnType<typeof spawn>>()

function killActiveStream(webContentsId: number): void {
  const existing = activeLogStreams.get(webContentsId)
  if (existing && !existing.killed) {
    existing.kill()
  }
  activeLogStreams.delete(webContentsId)
}

export function register(): void {
  ipcMain.handle(Channel.startLogStream, async (event, repoPath: string) => {
    const key = normalizeRepoPath(repoPath)
    const webContents = event.sender
    const webContentsId = webContents.id

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
      activeLogStreams.set(webContentsId, proc)

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
        if (activeLogStreams.get(webContentsId) !== proc) return
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
