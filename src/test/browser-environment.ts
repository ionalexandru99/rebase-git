import { act } from '@testing-library/react'
import { Storage } from 'happy-dom'
import { vi } from 'vitest'

const DEFAULT_OBSERVED_RECT = { height: 800, width: 400 }
let observedRect = { ...DEFAULT_OBSERVED_RECT }
const liveResizeObservers = new Set<ResizeObserverMock>()

class ResizeObserverMock {
  private callback: ResizeObserverCallback
  private targets = new Set<Element>()

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
    liveResizeObservers.add(this)
  }

  emit(): void {
    for (const target of this.targets) {
      this.callback(
        [{ target, contentRect: { ...observedRect } as DOMRectReadOnly } as ResizeObserverEntry],
        this as unknown as ResizeObserver
      )
    }
  }

  observe = vi.fn((element: Element) => {
    this.targets.add(element)
    this.callback(
      [
        {
          target: element,
          contentRect: { ...observedRect } as DOMRectReadOnly
        } as ResizeObserverEntry
      ],
      this as unknown as ResizeObserver
    )
  })

  unobserve = vi.fn((element: Element) => {
    this.targets.delete(element)
  })

  disconnect = vi.fn(() => {
    this.targets.clear()
    liveResizeObservers.delete(this)
  })
}

export const resizeObserverMock = {
  setContentRect(rect: Partial<{ width: number; height: number }>): void {
    observedRect = { ...observedRect, ...rect }
    act(() => {
      for (const observer of [...liveResizeObservers]) {
        observer.emit()
      }
    })
  },
  reset(): void {
    observedRect = { ...DEFAULT_OBSERVED_RECT }
    liveResizeObservers.clear()
  }
}

export function installBrowserTestEnvironment(): void {
  const localStorageMock = new Storage()
  const sessionStorageMock = new Storage()
  for (const storageTarget of [globalThis, window]) {
    Object.defineProperties(storageTarget, {
      localStorage: {
        configurable: true,
        value: localStorageMock
      },
      sessionStorage: {
        configurable: true,
        value: sessionStorageMock
      }
    })
  }

  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false
    })
  })

  Object.defineProperty(window, 'ResizeObserver', {
    writable: true,
    configurable: true,
    value: ResizeObserverMock
  })
}
