import contextMenuModule from 'electron-context-menu'

const contextMenu = contextMenuModule.default || contextMenuModule

export function setupContextMenu(): void {
  contextMenu({
    showSearchWithGoogle: false,
    showInspectElement: true,
    prepend: (_defaultActions, _params, _browserWindow) => [
      {
        label: 'Git GUI',
        visible: false
      }
    ]
  })
}
