import { parseOrThrow } from '@shared/codec'
import {
  Channel,
  PersistedTabsSchema,
  RefTreeTogglesSchema,
  SidebarPrefsSchema
} from '@shared/schemas/ipc'
import { ipcMain } from 'electron'
import { getSidecarConfig } from '../sidecar'
import {
  getPersistedTabs,
  getRefTreeToggles,
  getSidebarPrefs,
  setPersistedTabs,
  setRefTreeToggles,
  setSidebarPrefs
} from '../store'

export function register(): void {
  ipcMain.handle(Channel.getSidecarConfig, () => getSidecarConfig())

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
