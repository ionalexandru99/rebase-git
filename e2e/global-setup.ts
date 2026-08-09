import { spawn, type ChildProcess } from 'node:child_process'

const virtualDisplayStartupTimeoutMilliseconds = 5_000
const virtualDisplayShutdownTimeoutMilliseconds = 2_000

function waitForDisplayNumber(virtualDisplay: ChildProcess): Promise<string> {
  return new Promise((resolve, reject) => {
    const displayOutput = virtualDisplay.stdio[3]
    if (!displayOutput) {
      reject(new Error('Xvfb did not expose its display-number pipe'))
      return
    }

    let errorOutput = ''
    const timeout = setTimeout(() => {
      virtualDisplay.kill('SIGKILL')
      reject(new Error(`Xvfb did not start within 5 seconds: ${errorOutput.trim()}`))
    }, virtualDisplayStartupTimeoutMilliseconds)

    const cleanup = (): void => {
      clearTimeout(timeout)
      virtualDisplay.removeListener('error', onError)
      virtualDisplay.removeListener('exit', onExit)
    }
    const onError = (error: Error): void => {
      cleanup()
      reject(new Error(`Could not start Xvfb: ${error.message}`))
    }
    const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
      cleanup()
      reject(
        new Error(
          `Xvfb exited before becoming ready (${code ?? signal ?? 'unknown'}): ${errorOutput.trim()}`
        )
      )
    }

    virtualDisplay.stderr?.on('data', (chunk: Buffer) => {
      errorOutput += chunk.toString()
    })
    virtualDisplay.once('error', onError)
    virtualDisplay.once('exit', onExit)
    displayOutput.once('data', (chunk: Buffer) => {
      const displayNumber = chunk.toString().trim()
      if (!/^\d+$/.test(displayNumber)) {
        cleanup()
        virtualDisplay.kill('SIGKILL')
        reject(new Error(`Xvfb returned an invalid display number: ${displayNumber}`))
        return
      }
      cleanup()
      resolve(displayNumber)
    })
  })
}

async function stopVirtualDisplay(virtualDisplay: ChildProcess): Promise<void> {
  if (virtualDisplay.exitCode !== null || virtualDisplay.signalCode !== null) {
    return
  }
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      virtualDisplay.kill('SIGKILL')
      resolve()
    }, virtualDisplayShutdownTimeoutMilliseconds)
    virtualDisplay.once('exit', () => {
      clearTimeout(timeout)
      resolve()
    })
    virtualDisplay.kill('SIGTERM')
  })
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  if (process.platform !== 'linux' || process.env.REBASE_E2E_USE_DESKTOP === '1') {
    return async () => {}
  }

  const hostDisplay = process.env.DISPLAY ?? ''
  const virtualDisplay = spawn(
    'Xvfb',
    ['-displayfd', '3', '-screen', '0', '1920x1080x24', '-nolisten', 'tcp'],
    { stdio: ['ignore', 'ignore', 'pipe', 'pipe'] }
  )
  const displayNumber = await waitForDisplayNumber(virtualDisplay)
  process.env.REBASE_E2E_HOST_DISPLAY = hostDisplay
  process.env.REBASE_E2E_VIRTUAL_DISPLAY = '1'
  process.env.DISPLAY = `:${displayNumber}`

  return async () => {
    await stopVirtualDisplay(virtualDisplay)
    process.env.DISPLAY = hostDisplay
    delete process.env.REBASE_E2E_HOST_DISPLAY
    delete process.env.REBASE_E2E_VIRTUAL_DISPLAY
  }
}
