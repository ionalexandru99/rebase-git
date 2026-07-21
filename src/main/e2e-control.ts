import fs from 'node:fs'
import path from 'node:path'
import { SIDECAR_SERVICE_NAME } from './recovery-decision'
import type { StoreSchema } from './store-schema'

export const E2E_CONTROL_KEY = '__REBASE_E2E_CONTROL__'
const E2E_USER_DATA_PREFIX = 'rebase-e2e-user-data-'

interface ProcessMetric {
  pid: number
  type: string
  name?: string
  serviceName?: string
}

export interface E2eLifecycleSnapshot {
  mainPid: number
  sidecarPids: number[]
  sidecarProcessCount: number
  sidecarRespawnCount: number
}

export interface E2eControl {
  replaceStore: (overrides?: Partial<StoreSchema>) => StoreSchema
  inspectLifecycle: () => E2eLifecycleSnapshot
}

interface E2eControlOptions {
  argv: readonly string[]
  nodeEnv: string | undefined
  userDataDir: string
  tempDir: string
  target: Record<string, unknown>
  replaceStoreWithDefaults: (overrides?: Partial<StoreSchema>) => StoreSchema
  getMainPid: () => number
  getProcessMetrics: () => readonly ProcessMetric[]
  getSidecarRespawnCount: () => number
}

function canonicalizePath(value: string): string {
  const resolvedPath = path.resolve(value)
  try {
    return fs.realpathSync.native(resolvedPath)
  } catch {
    try {
      return path.join(
        fs.realpathSync.native(path.dirname(resolvedPath)),
        path.basename(resolvedPath)
      )
    } catch {
      return resolvedPath
    }
  }
}

function isIsolatedUserDataDir(userDataDir: string, tempDir: string): boolean {
  const resolvedUserDataDir = canonicalizePath(userDataDir)
  const resolvedTempDir = canonicalizePath(tempDir)
  const relativePath = path.relative(resolvedTempDir, resolvedUserDataDir)
  const isInsideTempDir =
    relativePath !== '' &&
    relativePath !== '..' &&
    !relativePath.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relativePath)
  return isInsideTempDir && path.basename(resolvedUserDataDir).startsWith(E2E_USER_DATA_PREFIX)
}

export function installE2eControl(options: E2eControlOptions): void {
  if (
    options.nodeEnv !== 'test' ||
    !options.argv.includes('--e2e') ||
    !isIsolatedUserDataDir(options.userDataDir, options.tempDir)
  ) {
    return
  }

  const control: E2eControl = {
    replaceStore: (overrides = {}) => options.replaceStoreWithDefaults(overrides),
    inspectLifecycle: () => {
      const sidecarPids = options
        .getProcessMetrics()
        .filter(
          (metric) =>
            metric.name === SIDECAR_SERVICE_NAME || metric.serviceName === SIDECAR_SERVICE_NAME
        )
        .map((metric) => metric.pid)
      return {
        mainPid: options.getMainPid(),
        sidecarPids,
        sidecarProcessCount: sidecarPids.length,
        sidecarRespawnCount: options.getSidecarRespawnCount()
      }
    }
  }

  options.target[E2E_CONTROL_KEY] = control
}
