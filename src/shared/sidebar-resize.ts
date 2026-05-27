export const SIDEBAR_RESIZE_END_EVENT = 'rebase:sidebar-resize-end'

export function isSidebarResizing(): boolean {
  return typeof document !== 'undefined' && document.body.dataset.sidebarResizing === 'true'
}
