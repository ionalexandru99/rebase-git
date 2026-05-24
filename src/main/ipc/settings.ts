import { decodeOrThrow, encodeOrThrow } from '@shared/codec'
import { Channel, PersistedTabs, RefTreeToggles, SidebarPrefs } from '@shared/schemas/ipc'
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

  ipcMain.handle(Channel.getSidebarPrefs, () => encodeOrThrow(SidebarPrefs, getSidebarPrefs()))
  ipcMain.handle(Channel.setSidebarPrefs, (_, payload: unknown) => {
    const decoded = decodeOrThrow(SidebarPrefs, payload)
    setSidebarPrefs(decoded)
  })

  ipcMain.handle(Channel.getRefTreeToggles, () =>
    encodeOrThrow(RefTreeToggles, getRefTreeToggles())
  )
  ipcMain.handle(Channel.setRefTreeToggles, (_, payload: unknown) => {
    const decoded = decodeOrThrow(RefTreeToggles, payload)
    setRefTreeToggles([...decoded])
  })

  ipcMain.handle(Channel.getPersistedTabs, () => encodeOrThrow(PersistedTabs, getPersistedTabs()))
  ipcMain.handle(Channel.setPersistedTabs, (_, payload: unknown) => {
    const decoded = decodeOrThrow(PersistedTabs, payload)
    setPersistedTabs({ tabs: [...decoded.tabs], activeIndex: decoded.activeIndex })
  })
}
