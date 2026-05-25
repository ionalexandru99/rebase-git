import { createVirtualizer } from '@tanstack/solid-virtual'
import { type Accessor, createSignal, onCleanup } from 'solid-js'

interface UseFixedVirtualizerOptions {
  count: Accessor<number>
  rowHeight: number
  overscan: number
  initialViewportHeight?: number
  onScrollFrame?: () => void
}

export function useFixedVirtualizer(options: UseFixedVirtualizerOptions) {
  const [viewportHeight, setViewportHeight] = createSignal(
    options.initialViewportHeight ?? (typeof window !== 'undefined' ? window.innerHeight : 800)
  )
  const [scrollTop, setScrollTop] = createSignal(0)

  let scrollElement: HTMLDivElement | undefined
  let resizeObserver: ResizeObserver | undefined

  const virtualizer = createVirtualizer({
    get count() {
      return options.count()
    },
    getScrollElement: () => scrollElement ?? null,
    estimateSize: () => options.rowHeight,
    overscan: options.overscan
  })

  const setScrollRef = (element: HTMLDivElement) => {
    scrollElement = element
    resizeObserver?.disconnect()
    const update = () => {
      if (element.clientHeight > 0) {
        setViewportHeight(element.clientHeight)
      }
      virtualizer.measure()
    }
    update()
    resizeObserver = new ResizeObserver(update)
    resizeObserver.observe(element)
  }

  let raf: number | null = null
  const onScroll = (event: Event & { currentTarget: HTMLDivElement }) => {
    const target = event.currentTarget
    if (raf !== null) {
      cancelAnimationFrame(raf)
    }
    raf = requestAnimationFrame(() => {
      raf = null
      options.onScrollFrame?.()
      setScrollTop(target.scrollTop)
    })
  }

  onCleanup(() => {
    if (raf !== null) {
      cancelAnimationFrame(raf)
    }
    resizeObserver?.disconnect()
  })

  const virtualItems = () => {
    const items = virtualizer.getVirtualItems()
    const count = options.count()
    if (items.length > 0 || count === 0) {
      return items
    }

    const viewport = viewportHeight()
    const overscan = options.overscan
    const start = Math.max(0, Math.floor(scrollTop() / options.rowHeight) - overscan)
    const visibleCount = Math.ceil(viewport / options.rowHeight) + overscan * 2
    const end = Math.min(count, start + visibleCount)
    return Array.from({ length: end - start }, (_, offset) => {
      const index = start + offset
      return {
        index,
        start: index * options.rowHeight,
        end: (index + 1) * options.rowHeight,
        size: options.rowHeight,
        key: index,
        lane: 0
      }
    })
  }

  const startIndex = () => {
    const items = virtualItems()
    return items.length > 0 ? items[0].index : 0
  }

  const endIndex = () => {
    const items = virtualItems()
    return items.length > 0 ? items[items.length - 1].index + 1 : 0
  }

  return {
    setScrollRef,
    onScroll,
    scrollTop,
    viewportHeight,
    virtualizer,
    virtualItems,
    startIndex,
    endIndex,
    totalHeight: () => virtualizer.getTotalSize()
  }
}
