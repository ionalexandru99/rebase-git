import { SIDEBAR_RESIZE_END_EVENT } from '@shared/sidebar-resize'
import type { UIEvent } from 'react'
import { useCallback, useEffect, useRef } from 'react'
import { type Accessor, createSignal } from '@/lib/react-compat'
import { createVirtualizer } from '@/lib/react-virtual-compat'

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

  const scrollElement = useRef<HTMLDivElement | null>(null)
  const resizeObserver = useRef<ResizeObserver | null>(null)
  const resizeFrame = useRef<number | null>(null)

  const virtualizer = createVirtualizer({
    get count() {
      return options.count()
    },
    getScrollElement: () => scrollElement.current,
    estimateSize: () => options.rowHeight,
    overscan: options.overscan
  })
  const virtualizerRef = useRef(virtualizer)
  virtualizerRef.current = virtualizer

  const measureViewport = useCallback(() => {
    const element = scrollElement.current
    if (!element) {
      return
    }
    if (element.clientHeight > 0) {
      setViewportHeight(element.clientHeight)
    }
    virtualizerRef.current.measure()
  }, [setViewportHeight])

  const scheduleMeasure = useCallback(() => {
    if (resizeFrame.current !== null) {
      return
    }
    resizeFrame.current = requestAnimationFrame(() => {
      resizeFrame.current = null
      measureViewport()
    })
  }, [measureViewport])

  const setScrollRef = useCallback(
    (element: HTMLDivElement | null) => {
      if (scrollElement.current === element) {
        return
      }
      resizeObserver.current?.disconnect()
      if (!element) {
        scrollElement.current = null
        return
      }
      scrollElement.current = element
      if (element.clientHeight > 0) {
        setViewportHeight(element.clientHeight)
      }
      resizeObserver.current = new ResizeObserver(() => {
        scheduleMeasure()
      })
      resizeObserver.current.observe(element)
    },
    [scheduleMeasure, setViewportHeight]
  )

  const onSidebarResizeEnd = useCallback(() => {
    scheduleMeasure()
  }, [scheduleMeasure])
  useEffect(() => {
    window.addEventListener(SIDEBAR_RESIZE_END_EVENT, onSidebarResizeEnd)
    return () => {
      window.removeEventListener(SIDEBAR_RESIZE_END_EVENT, onSidebarResizeEnd)
    }
  }, [onSidebarResizeEnd])

  const onScroll = (event: UIEvent<HTMLDivElement>) => {
    const target = event.currentTarget
    setScrollTop(target.scrollTop)
    setScrollRevision((revision) => revision + 1)
    options.onScrollFrame?.()
  }

  useEffect(() => {
    return () => {
      if (resizeFrame.current !== null) {
        cancelAnimationFrame(resizeFrame.current)
      }
      resizeObserver.current?.disconnect()
    }
  }, [])

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
    return items[0]?.index ?? 0
  }

  const endIndex = () => {
    scrollRevision()
    const items = virtualItems()
    const last = items.at(-1)
    return last ? last.index + 1 : 0
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
