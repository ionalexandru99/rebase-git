// Only macOS hides the native frame (`titleBarStyle: 'hiddenInset'`), so only there does the window
// need a strip to drag by and to clear the traffic lights. Elsewhere it is dead space.
export function Titlebar() {
  if (window.electronAPI.platform !== 'darwin') {
    return null
  }
  return <header className="drag-region h-[34px] shrink-0 bg-chrome" />
}
