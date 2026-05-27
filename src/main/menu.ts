import contextMenu from 'electron-context-menu'

export function setupContextMenu(): void {
  contextMenu({
    showSearchWithGoogle: false,
    showInspectElement: process.env.NODE_ENV !== 'production',
    prepend: (_defaultActions, _params, _browserWindow) => [
      {
        label: 'Git GUI',
        visible: false
      }
    ]
  })
}
