import { AsyncLocalStorage } from 'node:async_hooks'
import { type ChildProcess, execFile, spawn, spawnSync } from 'node:child_process'
import { Context, Effect, Layer, ManagedRuntime } from 'effect'

export const MAX_STDERR_BYTES = 4096
const FORCE_KILL_DELAY_MS = 2_000
const PROCESS_EXIT_POLL_MS = 10

interface TrackedChild {
  child: ChildProcess
  exited: Promise<void>
  terminate: () => Promise<void>
}

interface ChildRegistry {
  children: Set<TrackedChild>
  cancelling: boolean
}

export interface RepoOperation {
  readonly repoPath: string
}

const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds))

function processGroupRunning(child: ChildProcess): boolean {
  if (child.pid === undefined) {
    return false
  }
  if (process.platform === 'win32') {
    return child.exitCode === null && child.signalCode === null
  }
  try {
    process.kill(-child.pid, 0)
    return true
  } catch {
    return false
  }
}

function processRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function descendantPids(parentPid: number): Promise<number[]> {
  if (process.platform === 'win32') {
    return Promise.resolve([])
  }
  return new Promise((resolve) => {
    execFile('ps', ['-A', '-o', 'pid=', '-o', 'ppid='], { encoding: 'utf8' }, (error, stdout) => {
      if (error) {
        resolve([])
        return
      }
      const childrenByParent = new Map<number, number[]>()
      for (const line of stdout.split('\n')) {
        const [pidText, parentText] = line.trim().split(/\s+/)
        const pid = Number(pidText)
        const parent = Number(parentText)
        if (!Number.isInteger(pid) || !Number.isInteger(parent)) {
          continue
        }
        const children = childrenByParent.get(parent) ?? []
        children.push(pid)
        childrenByParent.set(parent, children)
      }
      const descendants: number[] = []
      const pending = [...(childrenByParent.get(parentPid) ?? [])]
      while (pending.length > 0) {
        const pid = pending.pop() as number
        descendants.push(pid)
        pending.push(...(childrenByParent.get(pid) ?? []))
      }
      resolve(descendants)
    })
  })
}

function terminateWindowsTree(pid: number): Promise<void> {
  return new Promise((resolve) => {
    execFile('taskkill', ['/pid', String(pid), '/t', '/f'], () => resolve())
  })
}

function terminateWindowsTreeSync(pid: number): void {
  spawnSync('taskkill', ['/pid', String(pid), '/t', '/f'], { stdio: 'ignore' })
}

function signalProcesses(pids: number[], signal: NodeJS.Signals): void {
  for (const pid of pids) {
    try {
      process.kill(pid, signal)
    } catch {}
  }
}

async function waitForProcesses(pids: number[]): Promise<void> {
  while (pids.some(processRunning)) {
    await delay(PROCESS_EXIT_POLL_MS)
  }
}

function signalProcessGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) {
    return
  }
  try {
    if (process.platform === 'win32') {
      child.kill(signal)
    } else {
      process.kill(-child.pid, signal)
    }
  } catch {
    try {
      child.kill(signal)
    } catch {}
  }
}

function waitForProcessGroup(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    let childClosed = child.exitCode !== null || child.signalCode !== null
    let timer: ReturnType<typeof setTimeout> | undefined
    let settled = false
    const finish = () => {
      if (settled) {
        return
      }
      if (!childClosed || processGroupRunning(child)) {
        timer = setTimeout(finish, PROCESS_EXIT_POLL_MS)
        return
      }
      settled = true
      if (timer !== undefined) {
        clearTimeout(timer)
      }
      resolve()
    }
    const closed = () => {
      childClosed = true
      finish()
    }
    child.once('exit', closed)
    child.once('close', closed)
    child.once('error', closed)
    finish()
  })
}

async function cancelChildren(registry: ChildRegistry): Promise<void> {
  registry.cancelling = true
  while (registry.children.size > 0) {
    await Promise.all([...registry.children].map((tracked) => tracked.terminate()))
  }
}

async function awaitChildren(registry: ChildRegistry): Promise<void> {
  while (registry.children.size > 0) {
    await Promise.all([...registry.children].map((tracked) => tracked.exited))
  }
}

export interface TrackedChildrenService {
  runRequest<A>(signal: AbortSignal, use: () => Promise<A>): Promise<A>
  beginRepoOperation(repoPath: string): RepoOperation
  registerRepoChild(repoPath: string, child: ChildProcess): void
  attachRequestChild(child: ChildProcess): void
  detachRequestChild(child: ChildProcess): void
  cancelRepoOperation(operation: RepoOperation): Promise<void>
  endRepoOperation(operation: RepoOperation): Promise<void>
  trackChild(child: ChildProcess): () => Promise<void>
  kill(): void
}

interface ManagedTrackedChildren extends TrackedChildrenService {
  close(): Promise<void>
}

function makeTrackedChildren(): ManagedTrackedChildren {
  const repoOperations = new Map<string, RepoOperation>()
  const repoOperationOwners = new WeakMap<RepoOperation, ChildRegistry | undefined>()
  const operationRegistries = new WeakMap<RepoOperation, ChildRegistry>()
  const requestRegistry = new AsyncLocalStorage<ChildRegistry>()
  const trackedProcesses = new WeakMap<ChildProcess, TrackedChild>()
  const processRegistry: ChildRegistry = { children: new Set(), cancelling: false }

  const trackProcess = (child: ChildProcess): TrackedChild => {
    const existing = trackedProcesses.get(child)
    if (existing) {
      return existing
    }
    const exited = waitForProcessGroup(child)
    let termination: Promise<void> | undefined
    const tracked = {
      child,
      exited,
      terminate: () => {
        if (termination) {
          return termination
        }
        termination = (async () => {
          if (process.platform === 'win32' && child.pid !== undefined) {
            await terminateWindowsTree(child.pid)
            await exited
            return
          }
          const descendants = child.pid === undefined ? [] : await descendantPids(child.pid)
          signalProcessGroup(child, 'SIGTERM')
          signalProcesses(descendants, 'SIGTERM')
          const allExited = Promise.all([exited, waitForProcesses(descendants)]).then(
            () => undefined
          )
          const forceKillTimer = setTimeout(() => {
            if (processGroupRunning(child)) {
              signalProcessGroup(child, 'SIGKILL')
            }
            signalProcesses(descendants, 'SIGKILL')
          }, FORCE_KILL_DELAY_MS)
          await allExited
          clearTimeout(forceKillTimer)
        })()
        return termination
      }
    }
    trackedProcesses.set(child, tracked)
    processRegistry.children.add(tracked)
    void tracked.exited.finally(() => processRegistry.children.delete(tracked))
    if (processRegistry.cancelling) {
      void tracked.terminate()
    }
    return tracked
  }

  const registerChild = (registry: ChildRegistry | undefined, child: ChildProcess): void => {
    if (!registry) {
      return
    }
    const tracked = trackProcess(child)
    registry.children.add(tracked)
    void tracked.exited.finally(() => registry.children.delete(tracked))
    if (registry.cancelling) {
      void tracked.terminate()
    }
  }

  return {
    runRequest: <A>(signal: AbortSignal, use: () => Promise<A>): Promise<A> => {
      const registry: ChildRegistry = { children: new Set(), cancelling: signal.aborted }
      const abort = () => {
        void cancelChildren(registry)
      }
      signal.addEventListener('abort', abort, { once: true })
      return requestRegistry.run(registry, async () => {
        try {
          if (signal.aborted) {
            await cancelChildren(registry)
          }
          return await use()
        } finally {
          signal.removeEventListener('abort', abort)
          if (signal.aborted) {
            await cancelChildren(registry)
          } else {
            await awaitChildren(registry)
          }
        }
      })
    },
    beginRepoOperation: (repoPath) => {
      const operation: RepoOperation = { repoPath }
      repoOperations.set(repoPath, operation)
      operationRegistries.set(operation, { children: new Set(), cancelling: false })
      repoOperationOwners.set(operation, requestRegistry.getStore())
      return operation
    },
    registerRepoChild: (repoPath, child) => {
      trackProcess(child)
      const request = requestRegistry.getStore()
      registerChild(request, child)
      const operation = repoOperations.get(repoPath)
      if (operation && repoOperationOwners.get(operation) === request) {
        registerChild(operationRegistries.get(operation), child)
      }
    },
    attachRequestChild: (child) => registerChild(requestRegistry.getStore(), child),
    detachRequestChild: (child) => {
      requestRegistry.getStore()?.children.delete(trackProcess(child))
    },
    cancelRepoOperation: async (operation) => {
      const registry = operationRegistries.get(operation)
      if (registry) {
        await cancelChildren(registry)
      }
    },
    endRepoOperation: async (operation) => {
      const registry = operationRegistries.get(operation)
      if (registry) {
        await awaitChildren(registry)
      }
      if (repoOperations.get(operation.repoPath) === operation) {
        repoOperations.delete(operation.repoPath)
      }
      operationRegistries.delete(operation)
      repoOperationOwners.delete(operation)
    },
    trackChild: (child) => trackProcess(child).terminate,
    kill: () => {
      processRegistry.cancelling = true
      for (const tracked of processRegistry.children) {
        if (process.platform === 'win32' && tracked.child.pid !== undefined) {
          terminateWindowsTreeSync(tracked.child.pid)
        } else {
          signalProcessGroup(tracked.child, 'SIGKILL')
        }
      }
    },
    close: () => cancelChildren(processRegistry)
  }
}

export class TrackedChildren extends Context.Tag('sidecar/TrackedChildren')<
  TrackedChildren,
  TrackedChildrenService
>() {}

export const TrackedChildrenLive = Layer.scoped(
  TrackedChildren,
  Effect.acquireRelease(Effect.sync(makeTrackedChildren), (registry) =>
    Effect.promise(() => registry.close())
  )
)

const trackedChildrenRuntime = ManagedRuntime.make(TrackedChildrenLive)

function withTrackedChildren<T>(use: (registry: TrackedChildrenService) => T): T {
  return trackedChildrenRuntime.runSync(TrackedChildren.pipe(Effect.map(use)))
}

function withTrackedChildrenPromise<T>(
  use: (registry: TrackedChildrenService) => Promise<T>
): Promise<T> {
  return trackedChildrenRuntime.runPromise(
    TrackedChildren.pipe(Effect.flatMap((registry) => Effect.promise(() => use(registry))))
  )
}

export function runWithRequestChildren<A>(signal: AbortSignal, use: () => Promise<A>): Promise<A> {
  return withTrackedChildrenPromise((registry) => registry.runRequest(signal, use))
}

export function beginRepoOperation(repoPath: string): RepoOperation {
  return withTrackedChildren((registry) => registry.beginRepoOperation(repoPath))
}

export function registerRepoChild(repoPath: string, child: ChildProcess): void {
  withTrackedChildren((registry) => registry.registerRepoChild(repoPath, child))
}

export function attachRequestChild(child: ChildProcess): void {
  withTrackedChildren((registry) => registry.attachRequestChild(child))
}

export function detachRequestChild(child: ChildProcess): void {
  withTrackedChildren((registry) => registry.detachRequestChild(child))
}

export function cancelRepoOperation(operation: RepoOperation): Promise<void> {
  return withTrackedChildrenPromise((registry) => registry.cancelRepoOperation(operation))
}

export function endRepoOperation(operation: RepoOperation): Promise<void> {
  return withTrackedChildrenPromise((registry) => registry.endRepoOperation(operation))
}

export function finalizeTrackedChildren(): Promise<void> {
  return trackedChildrenRuntime.dispose()
}

export function killTrackedChildren(): void {
  withTrackedChildren((registry) => registry.kill())
}

export function installTrackedChildShutdownHooks(): () => void {
  const onExit = () => killTrackedChildren()
  const onUnexpectedError = () => killTrackedChildren()
  const signalHandlers = new Map<NodeJS.Signals, () => void>()
  const forwardSignal = (signal: NodeJS.Signals) => {
    const handler = () => {
      killTrackedChildren()
      process.off(signal, handler)
      process.kill(process.pid, signal)
    }
    signalHandlers.set(signal, handler)
    process.once(signal, handler)
  }

  process.once('exit', onExit)
  process.once('uncaughtExceptionMonitor', onUnexpectedError)
  forwardSignal('SIGINT')
  forwardSignal('SIGTERM')

  return () => {
    process.off('exit', onExit)
    process.off('uncaughtExceptionMonitor', onUnexpectedError)
    for (const [signal, handler] of signalHandlers) {
      process.off(signal, handler)
    }
  }
}

export function capStderr(buffer: string): string {
  return buffer.length > MAX_STDERR_BYTES ? buffer.slice(-MAX_STDERR_BYTES) : buffer
}

export interface SpawnGitOptions {
  env?: NodeJS.ProcessEnv
  stdin?: string
  collectStdout?: boolean
  pipeStdout?: boolean
}

export interface SpawnGitResult {
  code: number | null
  stdout: string
  stderr: string
}

export interface RunningGitProcess {
  child: ChildProcess
  result: Promise<SpawnGitResult>
  terminate: () => Promise<void>
}

function repoPathFromArgs(args: string[]): string | undefined {
  const workTreeFlag = args.indexOf('-C')
  return workTreeFlag === -1 ? undefined : args[workTreeFlag + 1]
}

function startGitProcess(
  args: string[],
  options: SpawnGitOptions | undefined,
  contextual: boolean
): RunningGitProcess {
  const collectStdout = options?.collectStdout ?? true
  const pipeStdout = options?.pipeStdout ?? collectStdout
  const child = spawn('git', args, {
    stdio: [
      options?.stdin === undefined ? 'ignore' : 'pipe',
      pipeStdout ? 'pipe' : 'ignore',
      'pipe'
    ],
    env: options?.env,
    detached: process.platform !== 'win32'
  })
  const terminate = withTrackedChildren((registry) => registry.trackChild(child))
  if (contextual) {
    const repoPath = repoPathFromArgs(args)
    if (repoPath) {
      registerRepoChild(repoPath, child)
    }
  }
  const result = new Promise<SpawnGitResult>((resolve, reject) => {
    let stdout = ''
    let stderr = ''

    if (collectStdout) {
      child.stdout?.setEncoding('utf8')
      child.stdout?.on('data', (chunk: string) => {
        stdout += chunk
      })
    }

    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => {
      stderr = capStderr(stderr + chunk)
    })

    if (options?.stdin !== undefined) {
      child.stdin?.end(options.stdin)
    }

    child.once('error', reject)
    child.once('close', (code) => {
      resolve({ code, stdout, stderr })
    })
  })

  return { child, result, terminate }
}

export function startGit(args: string[], options?: SpawnGitOptions): RunningGitProcess {
  return startGitProcess(args, options, true)
}

export function startBackgroundGit(args: string[], options?: SpawnGitOptions): RunningGitProcess {
  return startGitProcess(args, options, false)
}

export function spawnGit(args: string[], options?: SpawnGitOptions): Promise<SpawnGitResult> {
  return startGit(args, options).result
}

// `rebase --continue` and `revert --continue` launch $GIT_EDITOR for the commit message and would
// block forever in a process with no tty; `rebase -i` reaches for $GIT_SEQUENCE_EDITOR the same way.
// LC_ALL pins the messages we classify, GIT_TERMINAL_PROMPT stops credential prompts.
export function nonInteractiveEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_EDITOR: 'true',
    GIT_SEQUENCE_EDITOR: 'true',
    GIT_TERMINAL_PROMPT: '0',
    LC_ALL: 'C'
  }
}

export interface RunGitOptions extends SpawnGitOptions {
  okExitCodes?: number[]
}

export function runGit(args: string[], options?: RunGitOptions): Promise<string> {
  const okExitCodes = options?.okExitCodes ?? [0]
  return spawnGit(args, options).then(({ code, stdout, stderr }) => {
    if (code !== null && okExitCodes.includes(code)) {
      return stdout
    }
    throw new Error(stderr.trim() || `git exited with code ${code}`)
  })
}
