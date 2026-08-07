import { parseOrThrow } from '@shared/codec'
import { Channel, RendererErrorReportSchema } from '@shared/schemas/ipc'
import { ipcMain } from 'electron'
import log from 'electron-log'
import { formatRendererCrash } from '../app/crash-log'

export function register(): void {
  ipcMain.handle(Channel.reportRendererError, (_event, payload: unknown) => {
    const report = parseOrThrow(RendererErrorReportSchema, payload)
    log.error(`[crash] renderer stopped drawing\n${formatRendererCrash(report)}`)
  })
}
