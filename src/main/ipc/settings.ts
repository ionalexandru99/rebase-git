import { parseOrThrow } from '@shared/codec'
import {
  Channel,
  PersistedTabsSchema,
  RefTreeTogglesSchema,
  SidebarPrefsSchema
} from '@shared/schemas/ipc'
import { isSidecarOpName } from '@shared/sidecar-ops'
import type { SidecarRequest } from '@shared/sidecar-registry'
import { ipcMain } from 'electron'
import { sidecarRequest } from '../sidecar'
import {
  getPersistedTabs,
  getRefTreeToggles,
  getSidebarPrefs,
  setPersistedTabs,
  setRefTreeToggles,
  setSidebarPrefs
} from '../store'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function register(): void {
  ipcMain.handle(Channel.sidecarRequest, (_event, op: unknown, body: unknown) => {
    if (!isSidecarOpName(op) || !isRecord(body)) {
      throw new Error('invalid sidecar request')
    }
    return sidecarRequest(op, body as SidecarRequest<typeof op>)
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
