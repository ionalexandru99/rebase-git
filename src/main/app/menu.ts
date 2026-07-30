import { app } from 'electron'
import contextMenu from 'electron-context-menu'

export function setupContextMenu(): void {
  contextMenu({
    showSearchWithGoogle: false,
    showSelectAll: true,
    showInspectElement: !app.isPackaged,
    shouldShowMenu: (_event, parameters) =>
      parameters.isEditable || parameters.selectionText.trim().length > 0
  })
}
