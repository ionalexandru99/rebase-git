import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

interface UseVirtualListOptions {
  rowCount: number
  rowHeight: number
  overscan?: number
  initialViewportHeight?: number
  onScrollFrame?: () => void
}

interface UseVirtualListResult {
  scrollRef: React.RefObject<HTMLDivElement | null>
  onScroll: (event: React.UIEvent<HTMLDivElement>) => void
  scrollTop: number
  viewportHeight: number
  startIndex: number
  endIndex: number
  totalHeight: number
}

export function useVirtualList({
  rowCount,
  rowHeight,
  overscan = 0,
  initialViewportHeight,
  onScrollFrame
}: UseVirtualListOptions): UseVirtualListResult {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState<number>(() => {
    if (typeof initialViewportHeight === 'number') return initialViewportHeight
    if (typeof window !== 'undefined') return window.innerHeight
    return 800
  })

  useLayoutEffect(() => {
    const element = scrollRef.current
    if (!element) return
    const update = () => {
      if (element.clientHeight > 0) setViewportHeight(element.clientHeight)
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(element)
    return () => ro.disconnect()
  }, [])

  const rafRef = useRef<number | null>(null)
  const frameRef = useRef(onScrollFrame)
  frameRef.current = onScrollFrame

  const onScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    const target = event.currentTarget
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      frameRef.current?.()
      setScrollTop(target.scrollTop)
    })
  }, [])

  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    },
    []
  )

  const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan)
  const endIndex = Math.min(
    rowCount,
    Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscan
  )
  const totalHeight = rowCount * rowHeight

  return {
    scrollRef,
    onScroll,
    scrollTop,
    viewportHeight,
    startIndex,
    endIndex,
    totalHeight
  }
}
