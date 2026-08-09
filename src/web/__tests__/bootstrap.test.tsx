import { act } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { startRuntimeRenderer } from '../bootstrap'

describe('startRuntimeRenderer', () => {
  it('renders the browser fallback when the preload bridge is unavailable', async () => {
    const container = document.createElement('div')
    const loadDesktopRenderer = vi.fn<() => Promise<unknown>>().mockResolvedValue(undefined)

    await act(() => startRuntimeRenderer(container, null, loadDesktopRenderer))

    expect(container).toHaveTextContent('Web runtime unavailable')
    expect(loadDesktopRenderer).not.toHaveBeenCalled()
  })

  it('loads the desktop renderer when the preload bridge is available', async () => {
    const container = document.createElement('div')
    const loadDesktopRenderer = vi.fn<() => Promise<unknown>>().mockResolvedValue(undefined)

    await startRuntimeRenderer(container, {}, loadDesktopRenderer)

    expect(loadDesktopRenderer).toHaveBeenCalledOnce()
    expect(container).toBeEmptyDOMElement()
  })
})
