import { Channel, type LogResponse } from '@shared/schemas/ipc'
import { ipcMain } from 'electron'
import { SidecarOp } from '../../sidecar/protocol'
import { sidecarRequest } from '../sidecar'

export function register(): void {
  ipcMain.handle(Channel.getLog, (_, repoPath: string, maxCount?: number) =>
    sidecarRequest<LogResponse>(SidecarOp.getLog, { repoPath, maxCount })
  )
}
