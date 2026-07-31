import { parseOrThrow } from '@shared/codec'
import {
  Channel,
  PersistedTabsSchema,
  PullDivergedStrategySchema,
  RefTreeTogglesSchema,
  SidebarPrefsSchema
} from '@shared/schemas/ipc'
import { ipcMain } from 'electron'
import { sidecarRpcCall } from '../sidecar/process'
import { isRendererRpcOp } from '../sidecar/rpc'
import {
  getPersistedTabs,
  getPullDivergedStrategy,
  getRefTreeToggles,
  getSidebarPrefs,
  setPersistedTabs,
  setPullDivergedStrategy,
  setRefTreeToggles,
  setSidebarPrefs
} from '../store/index'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function register(): void {
  ipcMain.handle(Channel.sidecarRequest, (_event, op: unknown, body: unknown) => {
    if (!isRecord(body)) {
      throw new Error('invalid sidecar request')
    }
    if (typeof op !== 'string' || !isRendererRpcOp(op)) {
      throw new Error('invalid sidecar request')
    }
    return sidecarRpcCall(op, body)
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

  ipcMain.handle(Channel.getPullDivergedStrategy, () =>
    parseOrThrow(PullDivergedStrategySchema, getPullDivergedStrategy())
  )
  ipcMain.handle(Channel.setPullDivergedStrategy, (_, payload: unknown) => {
    const decoded = parseOrThrow(PullDivergedStrategySchema, payload)
    setPullDivergedStrategy(decoded)
  })

  ipcMain.handle(Channel.getPersistedTabs, () =>
    parseOrThrow(PersistedTabsSchema, getPersistedTabs())
  )
  ipcMain.handle(Channel.setPersistedTabs, (_, payload: unknown) => {
    const decoded = parseOrThrow(PersistedTabsSchema, payload)
    setPersistedTabs({ tabs: [...decoded.tabs], activeIndex: decoded.activeIndex })
  })
}
