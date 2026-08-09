import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../renderer/index.css'
import { WebRuntimeUnavailable } from './WebRuntimeUnavailable'

type LoadDesktopRenderer = () => Promise<unknown>

export async function startRuntimeRenderer(
  container: HTMLElement,
  desktopBridge: unknown = Reflect.get(window, 'electronAPI'),
  loadDesktopRenderer: LoadDesktopRenderer = () => import('../renderer/main')
): Promise<void> {
  if (desktopBridge) {
    await loadDesktopRenderer()
    return
  }

  createRoot(container).render(
    <StrictMode>
      <WebRuntimeUnavailable />
    </StrictMode>
  )
}
