import { type Accessor, createSignal, onCleanup } from 'solid-js'

interface UseVirtualListOptions {
  rowCount: Accessor<number>
  rowHeight: number
  overscan?: number
  initialViewportHeight?: number
  onScrollFrame?: () => void
}

interface UseVirtualListResult {
  setScrollRef: (element: HTMLDivElement) => void
  onScroll: (event: Event & { currentTarget: HTMLDivElement }) => void
  scrollTop: Accessor<number>
  viewportHeight: Accessor<number>
  startIndex: Accessor<number>
  endIndex: Accessor<number>
  totalHeight: Accessor<number>
}

export function useVirtualList(options: UseVirtualListOptions): UseVirtualListResult {
  const [scrollTop, setScrollTop] = createSignal(0)
  const [viewportHeight, setViewportHeight] = createSignal(
    options.initialViewportHeight ?? (typeof window !== 'undefined' ? window.innerHeight : 800)
  )

  let resizeObserver: ResizeObserver | undefined
  const setScrollRef = (element: HTMLDivElement) => {
    const update = () => {
      if (element.clientHeight > 0) setViewportHeight(element.clientHeight)
    }
    update()
    resizeObserver = new ResizeObserver(update)
    resizeObserver.observe(element)
  }

  let raf: number | null = null
  const onScroll = (event: Event & { currentTarget: HTMLDivElement }) => {
    const target = event.currentTarget
    if (raf !== null) cancelAnimationFrame(raf)
    raf = requestAnimationFrame(() => {
      raf = null
      options.onScrollFrame?.()
      setScrollTop(target.scrollTop)
    })
  }

  onCleanup(() => {
    if (raf !== null) cancelAnimationFrame(raf)
    resizeObserver?.disconnect()
  })

  const overscan = options.overscan ?? 0
  const startIndex = () => Math.max(0, Math.floor(scrollTop() / options.rowHeight) - overscan)
  const endIndex = () =>
    Math.min(
      options.rowCount(),
      Math.ceil((scrollTop() + viewportHeight()) / options.rowHeight) + overscan
    )
  const totalHeight = () => options.rowCount() * options.rowHeight

  return { setScrollRef, onScroll, scrollTop, viewportHeight, startIndex, endIndex, totalHeight }
}
