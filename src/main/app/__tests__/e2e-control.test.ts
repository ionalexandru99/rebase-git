import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { storeDefaults } from '../../store/schema'
import { E2E_CONTROL_KEY, installE2eControl } from '../e2e-control'

const tempDir = os.tmpdir()
const isolatedUserDataDir = path.join(tempDir, 'rebase-e2e-user-data-test')

describe('main-process E2E control', () => {
  it('does not install the control surface outside the test environment', () => {
    const target: Record<string, unknown> = {}
    const options = {
      argv: ['Rebase', '--e2e'],
      nodeEnv: 'production',
      userDataDir: isolatedUserDataDir,
      tempDir,
      target,
      replaceStoreWithDefaults: vi.fn(),
      getMainPid: () => 10,
      getProcessMetrics: () => [],
      getSidecarRespawnCount: () => 0
    }

    installE2eControl(options)

    expect(target).not.toHaveProperty(E2E_CONTROL_KEY)
  })

  it('does not install the control surface without the exact e2e argument', () => {
    const target: Record<string, unknown> = {}

    installE2eControl({
      argv: ['Rebase', '--e2e=true'],
      nodeEnv: 'test',
      userDataDir: isolatedUserDataDir,
      tempDir,
      target,
      replaceStoreWithDefaults: vi.fn(),
      getMainPid: () => 10,
      getProcessMetrics: () => [],
      getSidecarRespawnCount: () => 0
    })

    expect(target).not.toHaveProperty(E2E_CONTROL_KEY)
  })

  it('does not install the control surface for a persistent user data directory', () => {
    const target: Record<string, unknown> = {}
    const options = {
      argv: ['Rebase', '--e2e'],
      nodeEnv: 'test',
      userDataDir: '/Users/person/Library/Application Support/Rebase',
      tempDir,
      target,
      replaceStoreWithDefaults: vi.fn(),
      getMainPid: () => 10,
      getProcessMetrics: () => [],
      getSidecarRespawnCount: () => 0
    }

    installE2eControl(options)

    expect(target).not.toHaveProperty(E2E_CONTROL_KEY)
  })

  it('atomically replaces the store through the gated control', () => {
    const target: Record<string, unknown> = {}
    const replacement = {
      sidebarOpen: false,
      onboardingComplete: true
    }
    const replacedStore = { ...storeDefaults, ...replacement }
    const replaceStoreWithDefaults = vi.fn(() => replacedStore)

    installE2eControl({
      argv: ['Rebase', '--e2e'],
      nodeEnv: 'test',
      userDataDir: isolatedUserDataDir,
      tempDir,
      target,
      replaceStoreWithDefaults,
      getMainPid: () => 10,
      getProcessMetrics: () => [],
      getSidecarRespawnCount: () => 0
    })

    const control = target[E2E_CONTROL_KEY] as {
      replaceStore: (overrides: typeof replacement) => unknown
    }
    expect(control.replaceStore(replacement)).toEqual(replacedStore)
    expect(replaceStoreWithDefaults).toHaveBeenCalledOnce()
    expect(replaceStoreWithDefaults).toHaveBeenCalledWith(replacement)
  })

  it('reports main and named-sidecar lifecycle state', () => {
    const target: Record<string, unknown> = {}

    installE2eControl({
      argv: ['Rebase', '--e2e'],
      nodeEnv: 'test',
      userDataDir: isolatedUserDataDir,
      tempDir,
      target,
      replaceStoreWithDefaults: vi.fn(),
      getMainPid: () => 101,
      getProcessMetrics: () => [
        { pid: 202, type: 'Utility', name: 'rebase git sidecar' },
        { pid: 303, type: 'Utility', name: 'Network Service' },
        { pid: 404, type: 'Tab' }
      ],
      getSidecarRespawnCount: () => 2
    })

    const control = target[E2E_CONTROL_KEY] as {
      inspectLifecycle: () => unknown
    }
    expect(control.inspectLifecycle()).toEqual({
      mainPid: 101,
      sidecarPids: [202],
      sidecarProcessCount: 1,
      sidecarRespawnCount: 2
    })
  })
})
