export function Titlebar() {
  if (window.electronAPI.platform !== 'darwin') {
    return null
  }
  return <header className="drag-region h-[34px] shrink-0 bg-chrome" />
}
