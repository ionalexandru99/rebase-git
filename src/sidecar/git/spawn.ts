import { AsyncLocalStorage } from 'node:async_hooks'
import { type ChildProcess, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { Context, Effect, Layer, ManagedRuntime } from 'effect'
import {
  createTrackedProcessGroup,
  killProcessGroupImmediately,
  type TrackedProcessGroup
  // @ts-expect-error Direct Node import requires an explicit TypeScript extension.
} from './process-tree.ts'

export const MAX_STDERR_BYTES = 4096

function processRepoKey(repoPath: string): string {
  try {
    return fs.realpathSync.native(repoPath)
  } catch {
    return path.resolve(repoPath)
  }
}

interface ChildRegistry {
  children: Set<TrackedProcessGroup>
  cancelling: boolean
}

export interface RepoOperation {
  readonly repoPath: string
}

async function cancelChildren(registry: ChildRegistry): Promise<void> {
  registry.cancelling = true
  await drainTrackedProcesses(registry.children)
}

export async function drainTrackedProcesses(children: Set<TrackedProcessGroup>): Promise<void> {
  while (children.size > 0) {
    const trackedProcesses = [...children]
    await Promise.all(trackedProcesses.map((tracked) => tracked.terminate()))
    for (const tracked of trackedProcesses) {
      children.delete(tracked)
    }
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
  openRepoReads(repoPath: string): void
  registerRepoChild(repoPath: string, child: ChildProcess): void
  cancelRepoReads(repoPath: string): Promise<void>
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
  const repoReadRegistries = new Map<string, ChildRegistry>()
  const repoOperationOwners = new WeakMap<RepoOperation, ChildRegistry | undefined>()
  const operationRegistries = new WeakMap<RepoOperation, ChildRegistry>()
  const requestRegistry = new AsyncLocalStorage<ChildRegistry>()
  const trackedProcesses = new WeakMap<ChildProcess, TrackedProcessGroup>()
  const processRegistry: ChildRegistry = { children: new Set(), cancelling: false }

  const trackProcess = (child: ChildProcess): TrackedProcessGroup => {
    const existing = trackedProcesses.get(child)
    if (existing) {
      return existing
    }
    const tracked = createTrackedProcessGroup(child)
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
      const key = processRepoKey(repoPath)
      const operation: RepoOperation = { repoPath: key }
      repoOperations.set(key, operation)
      operationRegistries.set(operation, { children: new Set(), cancelling: false })
      repoOperationOwners.set(operation, requestRegistry.getStore())
      return operation
    },
    openRepoReads: (repoPath) => {
      repoReadRegistries.set(processRepoKey(repoPath), {
        children: new Set(),
        cancelling: false
      })
    },
    registerRepoChild: (repoPath, child) => {
      trackProcess(child)
      const request = requestRegistry.getStore()
      registerChild(request, child)
      const key = processRepoKey(repoPath)
      const operation = repoOperations.get(key)
      if (operation && repoOperationOwners.get(operation) === request) {
        registerChild(operationRegistries.get(operation), child)
        return
      }
      let reads = repoReadRegistries.get(key)
      if (!reads) {
        reads = { children: new Set(), cancelling: false }
        repoReadRegistries.set(key, reads)
      }
      registerChild(reads, child)
    },
    cancelRepoReads: async (repoPath) => {
      const registry = repoReadRegistries.get(processRepoKey(repoPath))
      if (registry) {
        await cancelChildren(registry)
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
        killProcessGroupImmediately(tracked.child)
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

export function openRepoReads(repoPath: string): void {
  withTrackedChildren((registry) => registry.openRepoReads(repoPath))
}

export function registerRepoChild(repoPath: string, child: ChildProcess): void {
  withTrackedChildren((registry) => registry.registerRepoChild(repoPath, child))
}

export function cancelRepoReads(repoPath: string): Promise<void> {
  return withTrackedChildrenPromise((registry) => registry.cancelRepoReads(repoPath))
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

const NON_INTERACTIVE_ARGS = ['-c', 'core.askpass=']

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
  const child = spawn('git', [...NON_INTERACTIVE_ARGS, ...args], {
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
