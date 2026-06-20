import { type ChildProcess, spawn } from 'node:child_process'

export const MAX_STDERR_BYTES = 4096

// Keep only the trailing tail of stderr so a runaway git process can't grow the buffer unbounded.
export function capStderr(buffer: string): string {
  return buffer.length > MAX_STDERR_BYTES ? buffer.slice(-MAX_STDERR_BYTES) : buffer
}

export interface SpawnGitOptions {
  env?: NodeJS.ProcessEnv
  stdin?: string
  collectStdout?: boolean
  onSpawn?: (proc: ChildProcess) => void
}

export interface SpawnGitResult {
  code: number | null
  stdout: string
  stderr: string
}

// One git spawn for the whole sidecar: optionally collects stdout, always keeps a capped tail of
// stderr, and resolves with the raw exit code so each caller decides how to interpret it. Rejects
// only when the process fails to spawn (e.g. git missing). Arguments are passed as an array (never a
// shell), so callers are responsible for guarding ref/path args against option injection.
export function spawnGit(args: string[], options?: SpawnGitOptions): Promise<SpawnGitResult> {
  const collectStdout = options?.collectStdout ?? true
  return new Promise((resolve, reject) => {
    const proc = spawn('git', args, {
      stdio: [
        options?.stdin === undefined ? 'ignore' : 'pipe',
        collectStdout ? 'pipe' : 'ignore',
        'pipe'
      ],
      env: options?.env
    })
    options?.onSpawn?.(proc)

    let stdout = ''
    let stderr = ''

    if (collectStdout) {
      proc.stdout?.setEncoding('utf8')
      proc.stdout?.on('data', (chunk: string) => {
        stdout += chunk
      })
    }

    proc.stderr?.setEncoding('utf8')
    proc.stderr?.on('data', (chunk: string) => {
      stderr = capStderr(stderr + chunk)
    })

    if (options?.stdin !== undefined) {
      proc.stdin?.end(options.stdin)
    }

    proc.on('error', reject)
    proc.on('close', (code) => {
      resolve({ code, stdout, stderr })
    })
  })
}

export interface RunGitOptions {
  okExitCodes?: number[]
  stdin?: string
}

// Run git and resolve its stdout, rejecting with the captured stderr on a non-allowed exit code.
export function runGit(args: string[], options?: RunGitOptions): Promise<string> {
  const okExitCodes = options?.okExitCodes ?? [0]
  return spawnGit(args, { stdin: options?.stdin }).then(({ code, stdout, stderr }) => {
    if (code !== null && okExitCodes.includes(code)) {
      return stdout
    }
    throw new Error(stderr.trim() || `git exited with code ${code}`)
  })
}
