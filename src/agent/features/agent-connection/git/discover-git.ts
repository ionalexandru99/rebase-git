import { spawn } from 'node:child_process'
import type { OpenAgentSessionSuccess } from '@common/features/agent-connection'
import { Effect } from 'effect4'
import { terminateProcessTree } from './process-tree'

const MAX_VERSION_BYTES = 4 * 1024

export function discoverGit(
  terminationGraceMs: number
): Effect.Effect<OpenAgentSessionSuccess['git']> {
  return Effect.callback<OpenAgentSessionSuccess['git']>((resume) => {
    const child = spawn('git', ['--version'], {
      detached: process.platform !== 'win32',
      env: process.env,
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true
    })
    const chunks: Buffer[] = []
    let byteCount = 0
    let completed = false

    const finish = (result: OpenAgentSessionSuccess['git']) => {
      if (completed) {
        return
      }
      completed = true
      child.removeAllListeners('error')
      child.removeAllListeners('close')
      resume(Effect.succeed(result))
    }
    child.stdout?.on('data', (chunk: Buffer) => {
      const remaining = MAX_VERSION_BYTES - byteCount
      if (remaining > 0) {
        const retained = chunk.subarray(0, remaining)
        chunks.push(retained)
        byteCount += retained.length
      }
    })
    child.once('error', () => finish({ discovered: false, executable: 'git' }))
    child.once('close', (code) => {
      const output = Buffer.concat(chunks).toString('utf8').trim()
      const version = output.startsWith('git version ') ? output.slice('git version '.length) : ''
      finish(
        code === 0 && version.length > 0
          ? { discovered: true, executable: 'git', version }
          : { discovered: false, executable: 'git' }
      )
    })

    return Effect.sync(() => {
      completed = true
      child.removeAllListeners('error')
      child.removeAllListeners('close')
    }).pipe(Effect.andThen(terminateProcessTree(child, terminationGraceMs)))
  })
}
