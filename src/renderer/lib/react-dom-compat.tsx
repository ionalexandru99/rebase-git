import { createRoot } from 'react-dom/client'

export function render(content: () => React.ReactNode, rootElement: HTMLElement): void {
  createRoot(rootElement).render(content())
}

export { createRoot }
