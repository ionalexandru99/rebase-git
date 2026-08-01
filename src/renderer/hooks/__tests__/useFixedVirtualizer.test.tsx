import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useFixedVirtualizer } from '@/hooks/useFixedVirtualizer'

function ScrollHarness({
  onRender,
  paddingStart
}: {
  onRender?: () => void
  paddingStart?: number
}) {
  onRender?.()
  const virtualizer = useFixedVirtualizer({
    count: 500,
    rowHeight: 32,
    overscan: 5,
    paddingStart
  })

  return (
    <div
      ref={virtualizer.setScrollRef}
      data-testid="scroller"
      style={{ height: '320px', overflow: 'auto' }}
      onScroll={virtualizer.onScroll}
    >
      <span data-testid="viewport-width">{virtualizer.viewportWidth}</span>
      <div style={{ height: `${virtualizer.totalHeight}px`, position: 'relative' }}>
        {virtualizer.virtualItems.map((item) => (
          <div
            key={item.index}
            data-testid={`row-${item.index}`}
            style={{ position: 'absolute', top: `${item.start}px` }}
          >
            row-{item.index}
          </div>
        ))}
      </div>
    </div>
  )
}

describe('useFixedVirtualizer', () => {
  it('updates visible rows synchronously when scrollTop changes', () => {
    render(<ScrollHarness />)
    const scroller = screen.getByTestId('scroller') as HTMLDivElement
    Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 320 })

    expect(screen.getByTestId('row-0')).toBeInTheDocument()

    scroller.scrollTop = 640
    fireEvent.scroll(scroller)

    expect(screen.queryByTestId('row-0')).not.toBeInTheDocument()
    expect(screen.getByTestId('row-20')).toBeInTheDocument()
  })

  it('reports the observed container width', () => {
    render(<ScrollHarness />)

    expect(screen.getByTestId('viewport-width')).toHaveTextContent('400')
  })

  it('pushes every row down by the pinned padding at the start', () => {
    render(<ScrollHarness paddingStart={44} />)

    expect(screen.getByTestId('row-0')).toHaveStyle({ top: '44px' })
    expect(screen.getByTestId('row-1')).toHaveStyle({ top: '76px' })
  })

  it('renders its virtual window once for one scroll event', () => {
    let renderCount = 0
    render(<ScrollHarness onRender={() => renderCount++} />)
    const scroller = screen.getByTestId('scroller') as HTMLDivElement
    Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 320 })
    const rendersBeforeScroll = renderCount

    scroller.scrollTop = 640
    fireEvent.scroll(scroller)

    expect(renderCount - rendersBeforeScroll).toBe(1)
  })
})
