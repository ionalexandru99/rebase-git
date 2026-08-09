import { type ChildProcess, spawn } from 'node:child_process'
import { Effect } from 'effect4'

function awaitChildReaped(child: ChildProcess): Effect.Effect<void> {
  return Effect.callback<void>((resume) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resume(Effect.void)
      return
    }
    const reaped = () => resume(Effect.void)
    child.once('close', reaped)
    return Effect.sync(() => child.off('close', reaped))
  })
}

function signalPosixGroup(
  child: ChildProcess,
  processGroupId: number,
  signal: NodeJS.Signals
): void {
  try {
    process.kill(-processGroupId, signal)
    return
  } catch {}
  if (child.exitCode === null && child.signalCode === null) {
    try {
      child.kill(signal)
    } catch {}
  }
}

function posixGroupExists(processGroupId: number): boolean {
  try {
    process.kill(-processGroupId, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function awaitPosixGroupReaped(processGroupId: number): Effect.Effect<void> {
  return Effect.suspend(() =>
    posixGroupExists(processGroupId)
      ? Effect.sleep(10).pipe(Effect.andThen(awaitPosixGroupReaped(processGroupId)))
      : Effect.void
  )
}

function terminatePosixTree(child: ChildProcess, graceMs: number): Effect.Effect<void> {
  if (!child.pid) {
    return awaitChildReaped(child)
  }
  const processGroupId = child.pid
  return Effect.uninterruptible(
    Effect.gen(function* () {
      yield* Effect.sync(() => signalPosixGroup(child, processGroupId, 'SIGTERM'))
      yield* Effect.sleep(graceMs)
      yield* Effect.sync(() => signalPosixGroup(child, processGroupId, 'SIGKILL'))
      yield* awaitChildReaped(child)
      yield* awaitPosixGroupReaped(processGroupId).pipe(
        Effect.timeout(Math.max(1_000, graceMs * 4)),
        Effect.ignore
      )
    })
  )
}

function runTaskkill(child: ChildProcess, force: boolean): Effect.Effect<void> {
  if (!child.pid) {
    return Effect.void
  }
  return Effect.callback<void>((resume) => {
    const killer = spawn(
      'taskkill.exe',
      ['/PID', String(child.pid), '/T', ...(force ? ['/F'] : [])],
      { stdio: 'ignore', windowsHide: true }
    )
    let completed = false
    const finish = (useFallback: boolean) => {
      if (completed) {
        return
      }
      completed = true
      if (useFallback && child.exitCode === null && child.signalCode === null) {
        try {
          child.kill(force ? 'SIGKILL' : 'SIGTERM')
        } catch {}
      }
      killer.removeAllListeners()
      resume(Effect.void)
    }
    killer.once('error', () => finish(true))
    killer.once('close', (code) => finish(code !== 0))
    return Effect.sync(() => {
      killer.removeAllListeners()
      if (killer.exitCode === null && killer.signalCode === null) {
        killer.kill()
      }
    })
  })
}

function terminateWindowsTree(child: ChildProcess, graceMs: number): Effect.Effect<void> {
  return Effect.uninterruptible(
    Effect.gen(function* () {
      if (child.exitCode !== null || child.signalCode !== null) {
        return
      }
      yield* runTaskkill(child, false)
      yield* Effect.sleep(graceMs)
      if (child.exitCode === null && child.signalCode === null) {
        yield* runTaskkill(child, true)
        yield* awaitChildReaped(child)
      }
    })
  )
}

export function terminateProcessTree(child: ChildProcess, graceMs: number): Effect.Effect<void> {
  return process.platform === 'win32'
    ? terminateWindowsTree(child, graceMs)
    : terminatePosixTree(child, graceMs)
}
