import { app } from 'electron'
import contextMenu from 'electron-context-menu'

// The renderer owns right-click for git actions (branch/commit/file menus). Keep the native OS
// menu only where the renderer has nothing to offer: editable fields and selected text, so
// copy/cut/paste still work. Without this guard electron-context-menu pops a native menu on every
// right-click and visually clobbers the in-app context menus.
export function setupContextMenu(): void {
  contextMenu({
    showSearchWithGoogle: false,
    showSelectAll: true,
    showInspectElement: !app.isPackaged,
    shouldShowMenu: (_event, parameters) =>
      parameters.isEditable || parameters.selectionText.trim().length > 0
  })
}
