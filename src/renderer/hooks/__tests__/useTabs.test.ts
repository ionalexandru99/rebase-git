import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useTabs } from '../useTabs'

function dispatchKey(init: KeyboardEventInit & { key: string }) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }))
  })
}

describe('useTabs keyboard nav', () => {
  it('Cmd+T opens a new tab and activates it', () => {
    const { result } = renderHook(() => useTabs())
    const initialId = result.current.activeTabId

    dispatchKey({ key: 't', metaKey: true })

    expect(result.current.tabs).toHaveLength(2)
    expect(result.current.activeTabId).not.toBe(initialId)
  })

  it('Cmd+W closes the active tab', () => {
    const { result } = renderHook(() => useTabs())
    dispatchKey({ key: 't', metaKey: true })
    dispatchKey({ key: 't', metaKey: true })
    expect(result.current.tabs).toHaveLength(3)

    dispatchKey({ key: 'w', metaKey: true })
    expect(result.current.tabs).toHaveLength(2)
  })

  it('Cmd+Shift+] moves to the next tab and wraps around', () => {
    const { result } = renderHook(() => useTabs())
    dispatchKey({ key: 't', metaKey: true })
    dispatchKey({ key: 't', metaKey: true })

    const [first, second, third] = result.current.tabs
    act(() => {
      result.current.setActiveTabId(first.id)
    })

    dispatchKey({ key: ']', code: 'BracketRight', metaKey: true, shiftKey: true })
    expect(result.current.activeTabId).toBe(second.id)

    dispatchKey({ key: ']', code: 'BracketRight', metaKey: true, shiftKey: true })
    expect(result.current.activeTabId).toBe(third.id)

    dispatchKey({ key: ']', code: 'BracketRight', metaKey: true, shiftKey: true })
    expect(result.current.activeTabId).toBe(first.id)
  })

  it('Cmd+Shift+[ moves to the previous tab and wraps around', () => {
    const { result } = renderHook(() => useTabs())
    dispatchKey({ key: 't', metaKey: true })
    dispatchKey({ key: 't', metaKey: true })

    const [first, , third] = result.current.tabs
    act(() => {
      result.current.setActiveTabId(first.id)
    })

    dispatchKey({ key: '[', code: 'BracketLeft', metaKey: true, shiftKey: true })
    expect(result.current.activeTabId).toBe(third.id)
  })

  it('does nothing for cycle shortcuts when only one tab is open', () => {
    const { result } = renderHook(() => useTabs())
    const onlyTabId = result.current.activeTabId

    dispatchKey({ key: ']', code: 'BracketRight', metaKey: true, shiftKey: true })
    dispatchKey({ key: '[', code: 'BracketLeft', metaKey: true, shiftKey: true })

    expect(result.current.activeTabId).toBe(onlyTabId)
    expect(result.current.tabs).toHaveLength(1)
  })

  it('shift+t / shift+w do not trigger new/close', () => {
    const { result } = renderHook(() => useTabs())
    dispatchKey({ key: 't', metaKey: true, shiftKey: true })
    dispatchKey({ key: 'w', metaKey: true, shiftKey: true })
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
    expect(result.current.tabs[0]).toMatchObject({ kind: 'repo', repoPath: '/repo/a' })
    expect(result.current.tabs[1]).toMatchObject({ kind: 'new' })
    expect(result.current.tabs[2]).toMatchObject({ kind: 'repo', repoPath: '/repo/b' })
  })

  it('uses the final Windows path segment for repo tab titles', () => {
    const { result } = renderHook(() => useTabs({ tabs: ['C:\\work\\repo-name'], activeIndex: 0 }))

    expect(result.current.tabDescriptors.map((tab) => tab.title)).toEqual(['repo-name'])
  })

  it('updates persistedSnapshot when tabs change', () => {
    const { result } = renderHook(() => useTabs({ tabs: ['/repo/a'], activeIndex: 0 }))
    expect(result.current.persistedSnapshot).toEqual({ tabs: ['/repo/a'], activeIndex: 0 })

    act(() => {
      result.current.newTab()
    })
    expect(result.current.persistedSnapshot.tabs).toEqual(['/repo/a', null])
    expect(result.current.persistedSnapshot.activeIndex).toBe(1)

    act(() => {
      result.current.openRepoInTab(result.current.tabs[1].id, '/repo/b')
    })
    expect(result.current.tabs[1]).toMatchObject({ kind: 'opening-repo', repoPath: '/repo/b' })
    expect(result.current.persistedSnapshot.tabs).toEqual(['/repo/a', null])

    act(() => {
      result.current.confirmRepoOpen(result.current.tabs[1].id, '/repo/b')
    })
    expect(result.current.tabs[1]).toMatchObject({ kind: 'repo', repoPath: '/repo/b' })
    expect(result.current.persistedSnapshot.tabs).toEqual(['/repo/a', '/repo/b'])
  })

  it('clamps activeIndex when it is out of range', () => {
    const { result } = renderHook(() => useTabs({ tabs: ['/repo/a'], activeIndex: 99 }))
    expect(result.current.activeTabId).toBe(result.current.tabs[0].id)
  })

  it('falls back to a single empty tab when persisted state is empty', () => {
    const { result } = renderHook(() => useTabs({ tabs: [], activeIndex: 0 }))
    expect(result.current.tabs).toHaveLength(1)
    expect(result.current.tabs[0]).toMatchObject({ kind: 'new' })
  })

  it('switches to an existing repo tab and removes the source tab for duplicate opens', () => {
    const { result } = renderHook(() => useTabs({ tabs: ['/repo/a', null], activeIndex: 1 }))
    const sourceTabId = result.current.tabs[1].id

    act(() => {
      const redirected = result.current.openRepoInTab(sourceTabId, '/repo/a/')
      expect(redirected).toBe(true)
    })

    expect(result.current.tabs).toHaveLength(1)
    expect(result.current.tabs[0]).toMatchObject({ kind: 'repo', repoPath: '/repo/a' })
    expect(result.current.activeTabId).toBe(result.current.tabs[0].id)
  })

  it('deduplicates persisted repo paths and preserves the active repo', () => {
    const { result } = renderHook(() =>
      useTabs({ tabs: ['/repo/a', '/repo/b', '/repo/a/'], activeIndex: 2 })
    )

    expect(result.current.tabs).toHaveLength(2)
    expect(result.current.persistedSnapshot.tabs).toEqual(['/repo/a', '/repo/b'])
    expect(result.current.tabs.find((tab) => tab.id === result.current.activeTabId)).toMatchObject({
      kind: 'repo',
      repoPath: '/repo/a'
    })
  })

  it('reconciles a canonical path with an existing tab', () => {
    const { result } = renderHook(() => useTabs({ tabs: ['/real/repo', null], activeIndex: 1 }))
    const sourceTabId = result.current.activeTabId

    act(() => {
      result.current.openRepoInTab(sourceTabId, '/links/repo')
      const retained = result.current.confirmRepoOpen(sourceTabId, '/real/repo')
      expect(retained).toBe(false)
    })

    expect(result.current.tabs).toHaveLength(1)
    expect(result.current.tabs[0]).toMatchObject({ kind: 'repo', repoPath: '/real/repo' })
    expect(result.current.activeTabId).toBe(result.current.tabs[0].id)
  })

  it('releases a failed opening path so another tab can try it', () => {
    const { result } = renderHook(() => useTabs({ tabs: [null], activeIndex: 0 }))
    const sourceTabId = result.current.activeTabId

    act(() => {
      result.current.openRepoInTab(sourceTabId, '/repo/missing')
      result.current.cancelRepoOpen(sourceTabId, '/repo/missing')
    })

    expect(result.current.tabs[0]).toMatchObject({ id: sourceTabId, kind: 'failed-repo' })
    expect(result.current.persistedSnapshot.tabs).toEqual([null])

    act(() => {
      result.current.newTab()
    })
    const retryTabId = result.current.activeTabId
    act(() => {
      const redirected = result.current.openRepoInTab(retryTabId, '/repo/missing')
      expect(redirected).toBe(false)
    })
    expect(result.current.tabs.find((tab) => tab.id === retryTabId)).toMatchObject({
      kind: 'opening-repo',
      repoPath: '/repo/missing'
    })
  })
})
