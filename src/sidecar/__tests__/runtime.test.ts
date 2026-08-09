import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SidecarCommand, SidecarMessage } from '../../common/legacy-sidecar-process'

const dependencies = vi.hoisted(() => ({
  applyNonInteractiveGitEnv: vi.fn(),
  createSidecarServer: vi.fn(),
  finalizeFetchSemaphores: vi.fn(),
  finalizeLogContinuations: vi.fn(),
  finalizeTrackedChildren: vi.fn(),
  installTrackedChildShutdownHooks: vi.fn()
}))

vi.mock('../git/environment', () => ({
  applyNonInteractiveGitEnv: dependencies.applyNonInteractiveGitEnv
}))
vi.mock('../git/spawn', () => ({
  finalizeTrackedChildren: dependencies.finalizeTrackedChildren,
  installTrackedChildShutdownHooks: dependencies.installTrackedChildShutdownHooks
}))
vi.mock('../operations/log-stream', () => ({
  finalizeLogContinuations: dependencies.finalizeLogContinuations
}))
vi.mock('../server/http', () => ({ createSidecarServer: dependencies.createSidecarServer }))
vi.mock('../session/fetch-semaphore', () => ({
  finalizeFetchSemaphores: dependencies.finalizeFetchSemaphores
}))

import { type SidecarParentPort, startLegacySidecar } from '../runtime'

class FakeServer extends EventEmitter {
  readonly close = vi.fn((callback: () => void) => callback())
  readonly closeAllConnections = vi.fn()
  readonly listen = vi.fn((_port: number, _hostname: string, callback: () => void) => callback())
}

class FakeParentPort implements SidecarParentPort {
  readonly messages: SidecarMessage[] = []
  private listener: ((event: { data: SidecarCommand }) => void) | undefined

  readonly postMessage = (message: SidecarMessage): void => {
    this.messages.push(message)
  }

  readonly on = (_event: 'message', listener: (event: { data: SidecarCommand }) => void): void => {
    this.listener = listener
  }

  send(command: SidecarCommand): void {
    this.listener?.({ data: command })
  }
}

const startCommand = {
  type: 'start',
  hostname: '127.0.0.1',
  port: 43123,
  token: 'secret'
} as const

describe('startLegacySidecar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dependencies.installTrackedChildShutdownHooks.mockReturnValue(vi.fn())
    dependencies.finalizeFetchSemaphores.mockResolvedValue(undefined)
    dependencies.finalizeLogContinuations.mockResolvedValue(undefined)
    dependencies.finalizeTrackedChildren.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('starts the server and reports readiness', () => {
    const server = new FakeServer()
    const parentPort = new FakeParentPort()
    dependencies.createSidecarServer.mockReturnValue(server)

    startLegacySidecar(parentPort)
    parentPort.send(startCommand)

    expect(dependencies.createSidecarServer).toHaveBeenCalledWith('secret')
    expect(server.listen).toHaveBeenCalledWith(43123, '127.0.0.1', expect.any(Function))
    expect(parentPort.messages).toEqual([{ type: 'ready' }])
  })

  it('rejects a repeated start without creating another server', () => {
    const server = new FakeServer()
    const parentPort = new FakeParentPort()
    dependencies.createSidecarServer.mockReturnValue(server)

    startLegacySidecar(parentPort)
    parentPort.send(startCommand)
    parentPort.send({ ...startCommand, port: 43124 })

    expect(dependencies.createSidecarServer).toHaveBeenCalledOnce()
    expect(parentPort.messages).toEqual([
      { type: 'ready' },
      { type: 'error', message: 'Sidecar has already been started' }
    ])
  })

  it('reports listen failures and shuts down with an error', async () => {
    const server = new FakeServer()
    const parentPort = new FakeParentPort()
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    server.listen.mockImplementation(() => server)
    dependencies.createSidecarServer.mockReturnValue(server)

    startLegacySidecar(parentPort)
    parentPort.send(startCommand)
    server.emit('error', new Error('address unavailable'))

    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1))
    expect(parentPort.messages).toEqual([{ type: 'error', message: 'address unavailable' }])
    expect(server.close).toHaveBeenCalledOnce()
  })

  it('closes the server and tracked resources before stopping', async () => {
    const server = new FakeServer()
    const parentPort = new FakeParentPort()
    const removeTrackedChildShutdownHooks = vi.fn()
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    dependencies.createSidecarServer.mockReturnValue(server)
    dependencies.installTrackedChildShutdownHooks.mockReturnValue(removeTrackedChildShutdownHooks)

    startLegacySidecar(parentPort)
    parentPort.send(startCommand)
    parentPort.send({ type: 'stop' })

    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0))
    expect(server.close).toHaveBeenCalledOnce()
    expect(server.closeAllConnections).toHaveBeenCalledOnce()
    expect(removeTrackedChildShutdownHooks).toHaveBeenCalledOnce()
    expect(dependencies.finalizeLogContinuations).toHaveBeenCalledOnce()
    expect(dependencies.finalizeTrackedChildren).toHaveBeenCalledOnce()
    expect(dependencies.finalizeFetchSemaphores).toHaveBeenCalledOnce()
  })
})
