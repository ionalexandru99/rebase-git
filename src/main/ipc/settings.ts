import { decodeOrThrow, encodeOrThrow } from '@shared/codec'
import { Channel, RefTreeToggles, SidebarPrefs } from '@shared/schemas/ipc'
import { ipcMain } from 'electron'
import { getRefTreeToggles, getSidebarPrefs, setRefTreeToggles, setSidebarPrefs } from '../store'

export function register(): void {
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
}
