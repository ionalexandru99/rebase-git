import { describe, expect, it, vi } from 'vitest'
import { type FocusableWindow, focusExistingWindow } from '../single-instance'

function fakeWindow(overrides: Partial<FocusableWindow> = {}): FocusableWindow {
  return {
    isDestroyed: () => false,
    isMinimized: () => false,
    restore: vi.fn(),
    focus: vi.fn(),
    ...overrides
  }
}

describe('focusExistingWindow', () => {
  it('focuses an existing, non-minimized window without restoring it', () => {
    const win = fakeWindow()
    focusExistingWindow(win)
    expect(win.restore).not.toHaveBeenCalled()
    expect(win.focus).toHaveBeenCalledTimes(1)
  })

  it('restores a minimized window before focusing it', () => {
    const win = fakeWindow({ isMinimized: () => true })
    focusExistingWindow(win)
    expect(win.restore).toHaveBeenCalledTimes(1)
    expect(win.focus).toHaveBeenCalledTimes(1)
  })

  it('does nothing when there is no window', () => {
    expect(() => focusExistingWindow(null)).not.toThrow()
  })

  it('does nothing when the window is destroyed', () => {
    const win = fakeWindow({ isDestroyed: () => true })
    focusExistingWindow(win)
    expect(win.focus).not.toHaveBeenCalled()
  })
})
