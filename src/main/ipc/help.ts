import { Channel } from '@shared/channels'
import { HELP_LINKS, isHelpTopic } from '@shared/help-links'
import { ipcMain, shell } from 'electron'

export function register(): void {
  ipcMain.handle(Channel.openHelpLink, async (_event, topic: unknown) => {
    if (!isHelpTopic(topic)) {
      throw new Error('unknown help topic')
    }
    await shell.openExternal(HELP_LINKS[topic])
  })
}
