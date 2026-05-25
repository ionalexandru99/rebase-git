import { renderHook } from '@solidjs/testing-library'
import { describe, expect, it } from 'vitest'
import { useTabs } from '../useTabs'

function dispatchKey(init: KeyboardEventInit & { key: string }) {
  window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }))
}

describe('useTabs keyboard nav', () => {
  it('Cmd+T opens a new tab and activates it', () => {
    const { result } = renderHook(() => useTabs())
    const initialId = result.activeTabId()

    dispatchKey({ key: 't', metaKey: true })

    expect(result.tabs()).toHaveLength(2)
    expect(result.activeTabId()).not.toBe(initialId)
  })

  it('Cmd+W closes the active tab', () => {
    const { result } = renderHook(() => useTabs())
    dispatchKey({ key: 't', metaKey: true })
    dispatchKey({ key: 't', metaKey: true })
    expect(result.tabs()).toHaveLength(3)

    dispatchKey({ key: 'w', metaKey: true })
    expect(result.tabs()).toHaveLength(2)
  })

  it('Cmd+Shift+] moves to the next tab and wraps around', () => {
    const { result } = renderHook(() => useTabs())
    dispatchKey({ key: 't', metaKey: true })
    dispatchKey({ key: 't', metaKey: true })

    const [first, second, third] = result.tabs()
    result.setActiveTabId(first.id)

    dispatchKey({ key: ']', code: 'BracketRight', metaKey: true, shiftKey: true })
    expect(result.activeTabId()).toBe(second.id)

    dispatchKey({ key: ']', code: 'BracketRight', metaKey: true, shiftKey: true })
    expect(result.activeTabId()).toBe(third.id)

    dispatchKey({ key: ']', code: 'BracketRight', metaKey: true, shiftKey: true })
    expect(result.activeTabId()).toBe(first.id)
  })

  it('Cmd+Shift+[ moves to the previous tab and wraps around', () => {
    const { result } = renderHook(() => useTabs())
    dispatchKey({ key: 't', metaKey: true })
    dispatchKey({ key: 't', metaKey: true })

    const [first, , third] = result.tabs()
    result.setActiveTabId(first.id)

    dispatchKey({ key: '[', code: 'BracketLeft', metaKey: true, shiftKey: true })
    expect(result.activeTabId()).toBe(third.id)
  })

  it('does nothing for cycle shortcuts when only one tab is open', () => {
    const { result } = renderHook(() => useTabs())
    const onlyTabId = result.activeTabId()

    dispatchKey({ key: ']', code: 'BracketRight', metaKey: true, shiftKey: true })
    dispatchKey({ key: '[', code: 'BracketLeft', metaKey: true, shiftKey: true })

    expect(result.activeTabId()).toBe(onlyTabId)
    expect(result.tabs()).toHaveLength(1)
  })

  it('shift+t / shift+w do not trigger new/close', () => {
    const { result } = renderHook(() => useTabs())
    dispatchKey({ key: 't', metaKey: true, shiftKey: true })
    dispatchKey({ key: 'w', metaKey: true, shiftKey: true })
    expect(result.tabs()).toHaveLength(1)
  })
})

describe('useTabs persistence', () => {
  it('hydrates from a persisted state with one tab per persisted entry', () => {
    const { result } = renderHook(() =>
      useTabs({ tabs: ['/repo/a', null, '/repo/b'], activeIndex: 2 })
    )
    expect(result.tabs()).toHaveLength(3)
    expect(result.tabDescriptors().map((tab) => tab.title)).toEqual(['a', 'New tab', 'b'])
    expect(result.activeTabId()).toBe(result.tabs()[2].id)
    expect(result.initialRepoPath(result.tabs()[0].id)).toBe('/repo/a')
    expect(result.initialRepoPath(result.tabs()[1].id)).toBe(null)
    expect(result.initialRepoPath(result.tabs()[2].id)).toBe('/repo/b')
  })

  it('updates persistedSnapshot when tabs change', () => {
    const { result } = renderHook(() => useTabs({ tabs: ['/repo/a'], activeIndex: 0 }))
    expect(result.persistedSnapshot()).toEqual({ tabs: ['/repo/a'], activeIndex: 0 })

    result.newTab()
    expect(result.persistedSnapshot().tabs).toEqual(['/repo/a', null])
    expect(result.persistedSnapshot().activeIndex).toBe(1)

    result.reportTabRepo(result.tabs()[1].id, '/repo/b')
    expect(result.persistedSnapshot().tabs).toEqual(['/repo/a', '/repo/b'])
  })

  it('clamps activeIndex when it is out of range', () => {
    const { result } = renderHook(() => useTabs({ tabs: ['/repo/a'], activeIndex: 99 }))
    expect(result.activeTabId()).toBe(result.tabs()[0].id)
  })

  it('falls back to a single empty tab when persisted state is empty', () => {
    const { result } = renderHook(() => useTabs({ tabs: [], activeIndex: 0 }))
    expect(result.tabs()).toHaveLength(1)
    expect(result.initialRepoPath(result.tabs()[0].id)).toBe(null)
  })
})
