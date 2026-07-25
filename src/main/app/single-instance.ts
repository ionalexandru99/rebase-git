export interface FocusableWindow {
  isDestroyed(): boolean
  isMinimized(): boolean
  restore(): void
  focus(): void
}

// Bring the existing window to the front when a second app instance is launched. A minimized window
// must be restored first or focus() leaves it in the dock/taskbar.
export function focusExistingWindow(win: FocusableWindow | null): void {
  if (!win || win.isDestroyed()) {
    return
  }
  if (win.isMinimized()) {
    win.restore()
  }
  win.focus()
}
