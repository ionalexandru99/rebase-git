import { describe, expect, it, vi } from 'vitest'
import {
  type CrashEventSource,
  describeThrown,
  formatRendererCrash,
  installCrashLogging
} from '../crash-log'

function createSource() {
  const listeners = new Map<string, (thrown: unknown) => void>()
  const source: CrashEventSource = {
    on: (event, listener) => {
      listeners.set(event, listener)
      return source
    }
  }
  return {
    source,
    emit: (event: string, thrown: unknown) => {
      const listener = listeners.get(event)
      if (!listener) {
        throw new Error(`no listener registered for '${event}'`)
      }
      listener(thrown)
    }
  }
}

describe('main process crash logging', () => {
  it('logs an uncaught exception with its stack instead of dying silently', () => {
    const { source, emit } = createSource()
    const error = vi.fn()
    const thrown = new Error('window state is corrupt')
    thrown.stack = 'Error: window state is corrupt\n    at createWindow'

    installCrashLogging(source, { error })
    emit('uncaughtException', thrown)

    expect(error).toHaveBeenCalledOnce()
    expect(error.mock.calls[0]?.[0]).toContain('[crash] uncaught exception in the main process')
    expect(error.mock.calls[0]?.[0]).toContain('at createWindow')
  })

  it('logs an unhandled rejection', () => {
    const { source, emit } = createSource()
    const error = vi.fn()

    installCrashLogging(source, { error })
    emit('unhandledRejection', new Error('sidecar never answered'))

    expect(error.mock.calls[0]?.[0]).toContain('[crash] unhandled rejection in the main process')
    expect(error.mock.calls[0]?.[0]).toContain('sidecar never answered')
  })

  it('keeps the two crash kinds independent', () => {
    const { source, emit } = createSource()
    const error = vi.fn()

    installCrashLogging(source, { error })
    emit('unhandledRejection', 'first')
    emit('uncaughtException', 'second')

    expect(error).toHaveBeenCalledTimes(2)
    expect(error.mock.calls[0]?.[0]).toContain('first')
    expect(error.mock.calls[1]?.[0]).toContain('second')
  })
})

describe('describeThrown', () => {
  it('falls back to name and message when an error carries no stack', () => {
    const thrown = new TypeError('not a function')
    thrown.stack = undefined

    expect(describeThrown(thrown)).toBe('TypeError: not a function')
  })

  it('keeps a thrown string as-is', () => {
    expect(describeThrown('boom')).toBe('boom')
  })

  it('serializes a thrown object', () => {
    expect(describeThrown({ code: 'ENOENT' })).toBe('{"code":"ENOENT"}')
  })

  it('survives values JSON cannot serialize', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular

    expect(describeThrown(circular)).toBe('[object Object]')
    expect(describeThrown(undefined)).toBe('undefined')
  })
})

describe('formatRendererCrash', () => {
  it('logs the stack plus the component stack', () => {
    const entry = formatRendererCrash({
      message: 'cannot read length of null',
      stack: 'TypeError: cannot read length of null\n    at CommitList',
      componentStack: '\n    in CommitList\n    in TabView'
    })

    expect(entry).toContain('at CommitList')
    expect(entry).toContain('component stack:')
    expect(entry).toContain('in TabView')
  })

  it('falls back to the message when the error carried no stack', () => {
    expect(formatRendererCrash({ message: 'render failed' })).toBe('render failed')
  })
})
