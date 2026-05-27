import { SIDEBAR_RESIZE_END_EVENT } from '@shared/sidebar-resize'
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
  const [scrollRevision, setScrollRevision] = createSignal(0)

  let scrollElement: HTMLDivElement | undefined
  let resizeObserver: ResizeObserver | undefined
  let resizeFrame: number | null = null

  const virtualizer = createVirtualizer({
    get count() {
      return options.count()
    },
    getScrollElement: () => scrollElement ?? null,
    estimateSize: () => options.rowHeight,
    overscan: options.overscan
  })

  const measureViewport = () => {
    if (!scrollElement) {
      return
    }
    if (scrollElement.clientHeight > 0) {
      setViewportHeight(scrollElement.clientHeight)
    }
    virtualizer.measure()
  }

  const scheduleMeasure = () => {
    if (resizeFrame !== null) {
      return
    }
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = null
      measureViewport()
    })
  }

  const setScrollRef = (element: HTMLDivElement) => {
    scrollElement = element
    resizeObserver?.disconnect()
    measureViewport()
    resizeObserver = new ResizeObserver(() => {
      scheduleMeasure()
    })
    resizeObserver.observe(element)
  }

  const onSidebarResizeEnd = () => {
    scheduleMeasure()
  }
  window.addEventListener(SIDEBAR_RESIZE_END_EVENT, onSidebarResizeEnd)

  const onScroll = (event: Event & { currentTarget: HTMLDivElement }) => {
    const target = event.currentTarget
    setScrollTop(target.scrollTop)
    setScrollRevision((revision) => revision + 1)
    options.onScrollFrame?.()
  }

  onCleanup(() => {
    window.removeEventListener(SIDEBAR_RESIZE_END_EVENT, onSidebarResizeEnd)
    if (resizeFrame !== null) {
      cancelAnimationFrame(resizeFrame)
    }
    resizeObserver?.disconnect()
  })

  const virtualItems = () => {
    scrollRevision()
    scrollTop()
    const items = virtualizer.getVirtualItems()
    const count = options.count()
    if (items.length > 0 || count === 0) {
      return items
    }

    const viewport = viewportHeight()
    const overscan = options.overscan
    const offset = scrollTop()
    const start = Math.max(0, Math.floor(offset / options.rowHeight) - overscan)
    const visibleCount = Math.ceil(viewport / options.rowHeight) + overscan * 2
    const end = Math.min(count, start + visibleCount)
    return Array.from({ length: end - start }, (_, itemOffset) => {
      const index = start + itemOffset
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
    scrollRevision()
    const items = virtualItems()
    return items.length > 0 ? items[0].index : 0
  }

  const endIndex = () => {
    scrollRevision()
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
