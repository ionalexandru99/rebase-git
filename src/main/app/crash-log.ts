import type { RendererErrorReport } from '@shared/schemas/ipc'

export interface CrashLogSink {
  error: (entry: string) => void
}

export interface CrashEventSource {
  on: (event: string, listener: (thrown: unknown) => void) => unknown
}

export function describeThrown(thrown: unknown): string {
  if (thrown instanceof Error) {
    return thrown.stack ?? `${thrown.name}: ${thrown.message}`
  }
  if (typeof thrown === 'string' && thrown.length > 0) {
    return thrown
  }
  try {
    const serialized = JSON.stringify(thrown)
    return serialized === undefined ? String(thrown) : serialized
  } catch {
    return String(thrown)
  }
}

export function formatRendererCrash(report: RendererErrorReport): string {
  const trace = report.stack ?? report.message
  if (!report.componentStack) {
    return trace
  }
  return `${trace}\ncomponent stack:${report.componentStack}`
}

export function installCrashLogging(source: CrashEventSource, sink: CrashLogSink): void {
  source.on('uncaughtException', (thrown) => {
    sink.error(`[crash] uncaught exception in the main process\n${describeThrown(thrown)}`)
  })
  source.on('unhandledRejection', (thrown) => {
    sink.error(`[crash] unhandled rejection in the main process\n${describeThrown(thrown)}`)
  })
}
