import { type ChildProcess, execFile, spawnSync } from 'node:child_process'

const FORCE_KILL_DELAY_MS = 2_000
const PROCESS_EXIT_POLL_MS = 10
const PROCESS_EXIT_WAIT_MS = FORCE_KILL_DELAY_MS * 2

export interface TrackedProcessGroup {
  child: ChildProcess
  exited: Promise<void>
  terminate: () => Promise<void>
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

export function descendantPidsFromProcessTable(output: string, parentPid: number): number[] {
  const childrenByParent = new Map<number, number[]>()
  for (const line of output.split('\n')) {
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
  const visited = new Set([parentPid])
  const pending = [...(childrenByParent.get(parentPid) ?? [])]
  while (pending.length > 0) {
    const pid = pending.pop() as number
    if (visited.has(pid)) {
      continue
    }
    visited.add(pid)
    descendants.push(pid)
    pending.push(...(childrenByParent.get(pid) ?? []))
  }
  return descendants
}

function descendantPids(parentPid: number): Promise<number[]> {
  if (process.platform === 'win32') {
    return Promise.resolve([])
  }
  return new Promise((resolve) => {
    execFile('ps', ['-A', '-o', 'pid=', '-o', 'ppid='], { encoding: 'utf8' }, (error, stdout) => {
      resolve(error ? [] : descendantPidsFromProcessTable(stdout, parentPid))
    })
  })
}

function terminateWindowsTree(pid: number): Promise<void> {
  return new Promise((resolve) => {
    execFile('taskkill', ['/pid', String(pid), '/t', '/f'], () => resolve())
  })
}

function signalProcesses(pids: number[], signal: NodeJS.Signals): void {
  for (const pid of pids) {
    try {
      process.kill(pid, signal)
    } catch {}
  }
}

export async function waitForProcesses(
  pids: number[],
  timeoutMilliseconds = PROCESS_EXIT_WAIT_MS
): Promise<void> {
  const deadline = Date.now() + timeoutMilliseconds
  while (pids.some(processRunning)) {
    const remainingMilliseconds = deadline - Date.now()
    if (remainingMilliseconds <= 0) {
      return
    }
    await delay(Math.min(PROCESS_EXIT_POLL_MS, remainingMilliseconds))
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

interface ProcessGroupExitTracker {
  exited: Promise<void>
  beginTermination: () => void
}

function trackProcessGroupExit(child: ChildProcess): ProcessGroupExitTracker {
  let beginTermination = () => {}
  const exited = new Promise<void>((resolve) => {
    let deadline: number | undefined
    let childClosed = child.exitCode !== null || child.signalCode !== null
    let timer: ReturnType<typeof setTimeout> | undefined
    let settled = false
    beginTermination = () => {
      deadline ??= Date.now() + PROCESS_EXIT_WAIT_MS
    }
    const complete = () => {
      settled = true
      if (timer !== undefined) {
        clearTimeout(timer)
      }
      child.off('exit', closed)
      child.off('close', closed)
      child.off('error', closed)
      resolve()
    }
    const finish = () => {
      if (settled) {
        return
      }
      if (!childClosed || processGroupRunning(child)) {
        let nextPollMilliseconds = PROCESS_EXIT_POLL_MS
        if (deadline !== undefined) {
          const remainingMilliseconds = deadline - Date.now()
          if (remainingMilliseconds <= 0) {
            complete()
            return
          }
          nextPollMilliseconds = Math.min(nextPollMilliseconds, remainingMilliseconds)
        }
        timer = setTimeout(finish, nextPollMilliseconds)
        return
      }
      complete()
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
  return { exited, beginTermination }
}

export function createTrackedProcessGroup(child: ChildProcess): TrackedProcessGroup {
  const exitTracker = trackProcessGroupExit(child)
  const { exited } = exitTracker
  let termination: Promise<void> | undefined
  return {
    child,
    exited,
    terminate: () => {
      if (termination) {
        return termination
      }
      termination = (async () => {
        exitTracker.beginTermination()
        if (process.platform === 'win32' && child.pid !== undefined) {
          await terminateWindowsTree(child.pid)
          await exited
          return
        }
        const descendants = child.pid === undefined ? [] : await descendantPids(child.pid)
        signalProcessGroup(child, 'SIGTERM')
        signalProcesses(descendants, 'SIGTERM')
        const allExited = Promise.all([exited, waitForProcesses(descendants)]).then(() => undefined)
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
}

export function killProcessGroupImmediately(child: ChildProcess): void {
  if (process.platform === 'win32' && child.pid !== undefined) {
    spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' })
  } else {
    signalProcessGroup(child, 'SIGKILL')
  }
}
