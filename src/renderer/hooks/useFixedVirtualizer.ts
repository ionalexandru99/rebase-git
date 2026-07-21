import { SIDEBAR_RESIZE_END_EVENT } from '@shared/sidebar-resize'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { UIEvent } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'

interface UseFixedVirtualizerOptions {
  count: number
  rowHeight: number
  overscan: number
  initialViewportHeight?: number
  onScrollFrame?: () => void
}

export function useFixedVirtualizer(options: UseFixedVirtualizerOptions) {
  const [viewportHeight, setViewportHeight] = useState(
    options.initialViewportHeight ?? (typeof window !== 'undefined' ? window.innerHeight : 800)
  )
  const scrollElement = useRef<HTMLDivElement | null>(null)
  const resizeObserver = useRef<ResizeObserver | null>(null)
  const resizeFrame = useRef<number | null>(null)

  const virtualizer = useVirtualizer({
    get count() {
      return options.count
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
  }, [])

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
    [scheduleMeasure]
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

  const onScroll = (_event: UIEvent<HTMLDivElement>) => {
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

  const measuredItems = virtualizer.getVirtualItems()
  const scrollTop = virtualizer.scrollOffset ?? scrollElement.current?.scrollTop ?? 0
  const start = Math.max(0, Math.floor(scrollTop / options.rowHeight) - options.overscan)
  const visibleCount = Math.ceil(viewportHeight / options.rowHeight) + options.overscan * 2
  const end = Math.min(options.count, start + visibleCount)
  const virtualItems =
    measuredItems.length > 0 || options.count === 0
      ? measuredItems
      : Array.from({ length: end - start }, (_, itemOffset) => {
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

  const startIndex = virtualItems[0]?.index ?? 0
  const lastVirtualItem = virtualItems.at(-1)
  const endIndex = lastVirtualItem ? lastVirtualItem.index + 1 : 0

  return {
    setScrollRef,
    onScroll,
    viewportHeight,
    virtualizer,
    virtualItems,
    startIndex,
    endIndex,
    totalHeight: virtualizer.getTotalSize()
  }
}
