import { parseOrThrow } from '@shared/codec'
import { type RpcWriteOp, rpcWriteOps } from '@shared/rpc'
import {
  Channel,
  PersistedTabsSchema,
  RefTreeTogglesSchema,
  SidebarPrefsSchema
} from '@shared/schemas/ipc'
import { SidecarOp, type SidecarOpName } from '@shared/sidecar-ops'
import { ipcMain } from 'electron'
import { sidecarRequest, sidecarRpcWrite } from '../sidecar'
import {
  getPersistedTabs,
  getRefTreeToggles,
  getSidebarPrefs,
  setPersistedTabs,
  setRefTreeToggles,
  setSidebarPrefs
} from '../store'

const sidecarOps = new Set<string>(Object.values(SidecarOp))
const rpcWriteOpNames = new Set<string>(Object.keys(rpcWriteOps))

function isSidecarOpName(value: unknown): value is SidecarOpName {
  return typeof value === 'string' && sidecarOps.has(value)
}

function isRpcWriteOpName(value: unknown): value is RpcWriteOp {
  return typeof value === 'string' && rpcWriteOpNames.has(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function register(): void {
  ipcMain.handle(Channel.sidecarRequest, (_event, op: unknown, body: unknown) => {
    if (!isRecord(body)) {
      throw new Error('invalid sidecar request')
    }
    if (isRpcWriteOpName(op)) {
      return sidecarRpcWrite(op, body)
    }
    if (!isSidecarOpName(op)) {
      throw new Error('invalid sidecar request')
    }
    return sidecarRequest(op, body)
  })

  ipcMain.handle(Channel.getSidebarPrefs, () => parseOrThrow(SidebarPrefsSchema, getSidebarPrefs()))
  ipcMain.handle(Channel.setSidebarPrefs, (_, payload: unknown) => {
    const decoded = parseOrThrow(SidebarPrefsSchema, payload)
    setSidebarPrefs(decoded)
  })

  ipcMain.handle(Channel.getRefTreeToggles, () =>
    parseOrThrow(RefTreeTogglesSchema, getRefTreeToggles())
  )
  ipcMain.handle(Channel.setRefTreeToggles, (_, payload: unknown) => {
    const decoded = parseOrThrow(RefTreeTogglesSchema, payload)
    setRefTreeToggles([...decoded])
  })

  ipcMain.handle(Channel.getPersistedTabs, () =>
    parseOrThrow(PersistedTabsSchema, getPersistedTabs())
  )
  ipcMain.handle(Channel.setPersistedTabs, (_, payload: unknown) => {
    const decoded = parseOrThrow(PersistedTabsSchema, payload)
    setPersistedTabs({ tabs: [...decoded.tabs], activeIndex: decoded.activeIndex })
  })
}
