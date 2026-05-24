import { Channel, type FetchResponse } from '@shared/schemas/ipc'
import { ipcMain } from 'electron'
import { SidecarOp } from '../../sidecar/protocol'
import { sidecarRequest } from '../sidecar'

export function register(): void {
  ipcMain.handle(Channel.fetchRepo, (_, repoPath: string) =>
    sidecarRequest<FetchResponse>(SidecarOp.fetchRepo, { repoPath })
  )
}
