import { render, screen } from '@solidjs/testing-library'
import { For } from 'solid-js'
import { describe, expect, it } from 'vitest'
import { useFixedVirtualizer } from '@/hooks/useFixedVirtualizer'

function ScrollHarness() {
  const virtualizer = useFixedVirtualizer({
    count: () => 500,
    rowHeight: 32,
    overscan: 5
  })

  return (
    <div
      ref={virtualizer.setScrollRef}
      data-testid="scroller"
      style={{ height: '320px', overflow: 'auto' }}
      onScroll={virtualizer.onScroll}
    >
      <div style={{ height: `${virtualizer.totalHeight()}px`, position: 'relative' }}>
        <For each={virtualizer.virtualItems()}>
          {(item) => (
            <div
              data-testid={`row-${item.index}`}
              style={{ position: 'absolute', top: `${item.start}px` }}
            >
              row-{item.index}
            </div>
          )}
        </For>
      </div>
    </div>
  )
}

describe('useFixedVirtualizer', () => {
  it('updates visible rows synchronously when scrollTop changes', () => {
    render(() => <ScrollHarness />)
    const scroller = screen.getByTestId('scroller') as HTMLDivElement
    Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 320 })

    expect(screen.getByTestId('row-0')).toBeInTheDocument()

    scroller.scrollTop = 640
    scroller.dispatchEvent(new Event('scroll', { bubbles: true }))

    expect(screen.queryByTestId('row-0')).not.toBeInTheDocument()
    expect(screen.getByTestId('row-20')).toBeInTheDocument()
  })
})
