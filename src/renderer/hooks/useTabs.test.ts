import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useTabs } from './useTabs'

function dispatchKey(init: KeyboardEventInit & { key: string }) {
  window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }))
}

describe('useTabs keyboard nav', () => {
  it('Cmd+T opens a new tab and activates it', () => {
    const { result } = renderHook(() => useTabs())
    const initialId = result.current.activeTabId

    act(() => dispatchKey({ key: 't', metaKey: true }))

    expect(result.current.tabs).toHaveLength(2)
    expect(result.current.activeTabId).not.toBe(initialId)
  })

  it('Cmd+W closes the active tab', () => {
    const { result } = renderHook(() => useTabs())
    act(() => dispatchKey({ key: 't', metaKey: true }))
    act(() => dispatchKey({ key: 't', metaKey: true }))
    expect(result.current.tabs).toHaveLength(3)

    act(() => dispatchKey({ key: 'w', metaKey: true }))
    expect(result.current.tabs).toHaveLength(2)
  })

  it('Cmd+Shift+] moves to the next tab and wraps around', () => {
    const { result } = renderHook(() => useTabs())
    act(() => dispatchKey({ key: 't', metaKey: true }))
    act(() => dispatchKey({ key: 't', metaKey: true }))

    const [first, second, third] = result.current.tabs
    act(() => result.current.setActiveTabId(first.id))

    act(() => dispatchKey({ key: ']', metaKey: true, shiftKey: true }))
    expect(result.current.activeTabId).toBe(second.id)

    act(() => dispatchKey({ key: ']', metaKey: true, shiftKey: true }))
    expect(result.current.activeTabId).toBe(third.id)

    act(() => dispatchKey({ key: ']', metaKey: true, shiftKey: true }))
    expect(result.current.activeTabId).toBe(first.id)
  })

  it('Cmd+Shift+[ moves to the previous tab and wraps around', () => {
    const { result } = renderHook(() => useTabs())
    act(() => dispatchKey({ key: 't', metaKey: true }))
    act(() => dispatchKey({ key: 't', metaKey: true }))

    const [first, , third] = result.current.tabs
    act(() => result.current.setActiveTabId(first.id))

    act(() => dispatchKey({ key: '[', metaKey: true, shiftKey: true }))
    expect(result.current.activeTabId).toBe(third.id)
  })

  it('does nothing for cycle shortcuts when only one tab is open', () => {
    const { result } = renderHook(() => useTabs())
    const onlyTabId = result.current.activeTabId

    act(() => dispatchKey({ key: ']', metaKey: true, shiftKey: true }))
    act(() => dispatchKey({ key: '[', metaKey: true, shiftKey: true }))

    expect(result.current.activeTabId).toBe(onlyTabId)
    expect(result.current.tabs).toHaveLength(1)
  })

  it('shift+t / shift+w do not trigger new/close', () => {
    const { result } = renderHook(() => useTabs())
    act(() => dispatchKey({ key: 't', metaKey: true, shiftKey: true }))
    expect(result.current.tabs).toHaveLength(1)
  })
})

describe('useTabs persistence', () => {
  it('hydrates from a persisted state with one tab per persisted entry', () => {
    const { result } = renderHook(() =>
      useTabs({ tabs: ['/repo/a', null, '/repo/b'], activeIndex: 2 })
    )
    expect(result.current.tabs).toHaveLength(3)
    expect(result.current.tabDescriptors.map((tab) => tab.title)).toEqual(['a', 'New tab', 'b'])
    expect(result.current.activeTabId).toBe(result.current.tabs[2].id)
    expect(result.current.initialRepoPath(result.current.tabs[0].id)).toBe('/repo/a')
    expect(result.current.initialRepoPath(result.current.tabs[1].id)).toBe(null)
    expect(result.current.initialRepoPath(result.current.tabs[2].id)).toBe('/repo/b')
  })

  it('updates persistedSnapshot when tabs change', () => {
    const { result } = renderHook(() => useTabs({ tabs: ['/repo/a'], activeIndex: 0 }))
    expect(result.current.persistedSnapshot).toEqual({ tabs: ['/repo/a'], activeIndex: 0 })

    act(() => result.current.newTab())
    expect(result.current.persistedSnapshot.tabs).toEqual(['/repo/a', null])
    expect(result.current.persistedSnapshot.activeIndex).toBe(1)

    act(() => result.current.reportTabRepo(result.current.tabs[1].id, '/repo/b'))
    expect(result.current.persistedSnapshot.tabs).toEqual(['/repo/a', '/repo/b'])
  })

  it('clamps activeIndex when it is out of range', () => {
    const { result } = renderHook(() => useTabs({ tabs: ['/repo/a'], activeIndex: 99 }))
    expect(result.current.activeTabId).toBe(result.current.tabs[0].id)
  })

  it('falls back to a single empty tab when persisted state is empty', () => {
    const { result } = renderHook(() => useTabs({ tabs: [], activeIndex: 0 }))
    expect(result.current.tabs).toHaveLength(1)
    expect(result.current.initialRepoPath(result.current.tabs[0].id)).toBe(null)
  })
})
