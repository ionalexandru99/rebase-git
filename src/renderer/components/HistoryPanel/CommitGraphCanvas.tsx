import { useLayoutEffect, useRef } from 'react'
import {
  collectRowEdges,
  createEdgeBatch,
  drawCommitDot,
  drawMergeGlyph,
  laneColor,
  laneX,
  readCssVar,
  readGraphMetrics,
  resetEdgeBatch,
  strokeEdgeBatch
} from '@/lib/git-graph/canvas'
import { getLayoutBoundary, getLayoutRow, type LayoutResult } from '@/lib/git-graph/layout'
import type { MergeSideRange } from './selectors'

interface CommitGraphCanvasProps {
  layout: LayoutResult
  scrollContainer: HTMLDivElement | undefined
  viewportHeight: number
  visibleSet: Set<string> | null
  railWidth: number
  themeNonce: number
  startIndex: number
  endIndex: number
  graphLayoutEndIndex: number
  mergeSideRanges?: ReadonlyMap<string, MergeSideRange>
}

export function CommitGraphCanvas(props: CommitGraphCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawFrameRef = useRef<number | null>(null)

  useLayoutEffect(() => {
    const scroller = props.scrollContainer
    void props.themeNonce
    if (!scroller) {
      return
    }
    let metrics = readGraphMetrics()
    const initialRootPx = metrics.rootPx
    const bgColor = readCssVar('--color-background', '#ffffff')
    const edgeBatch = createEdgeBatch()

    const drawCanvas = () => {
      const canvas = canvasRef.current
      if (!canvas) {
        return
      }
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        return
      }

      const viewportHeight = props.viewportHeight
      const visible = props.visibleSet
      const scaledRailWidth = props.railWidth * (metrics.rootPx / initialRootPx)
      const canvasWidth = Math.min(scaledRailWidth, scroller.clientWidth || scaledRailWidth)
      const dpr = window.devicePixelRatio || 1
      const liveScrollTop = scroller.scrollTop
      const bitmapWidth = Math.max(1, Math.round(canvasWidth * dpr))
      const bitmapHeight = Math.max(1, Math.round(viewportHeight * dpr))
      if (canvas.width !== bitmapWidth) {
        canvas.width = bitmapWidth
      }
      if (canvas.height !== bitmapHeight) {
        canvas.height = bitmapHeight
      }
      canvas.style.width = `${scaledRailWidth}px`

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, canvasWidth, viewportHeight)
      ctx.lineCap = 'round'

      const start = props.startIndex
      const end = Math.min(props.endIndex, props.graphLayoutEndIndex)
      resetEdgeBatch(edgeBatch)
      for (let index = start; index < end; index++) {
        const row = getLayoutRow(props.layout, index)
        if (!row) {
          continue
        }
        const yTop = index * metrics.rowHeight - liveScrollTop
        if (yTop + metrics.rowHeight < 0 || yTop > viewportHeight) {
          continue
        }
        const dim = !!(visible && !visible.has(row.commit.hash))
        collectRowEdges(
          edgeBatch,
          row,
          getLayoutBoundary(props.layout, index),
          getLayoutBoundary(props.layout, index + 1),
          yTop,
          index === 0,
          dim,
          metrics
        )
      }
      strokeEdgeBatch(ctx, edgeBatch)

      for (let index = start; index < end; index++) {
        const row = getLayoutRow(props.layout, index)
        if (!row) {
          continue
        }
        const yTop = index * metrics.rowHeight - liveScrollTop
        if (yTop + metrics.rowHeight < 0 || yTop > viewportHeight) {
          continue
        }
        const dim = !!(visible && !visible.has(row.commit.hash))
        drawCommitDot(ctx, row, yTop, dim, bgColor, metrics)
        const glyph = props.mergeSideRanges?.get(row.commit.hash)?.glyph
        if (!glyph) {
          continue
        }
        drawMergeGlyph(
          ctx,
          laneX(row.commitLane, metrics),
          yTop + metrics.rowHeight / 2,
          glyph,
          laneColor(row.commitLane),
          metrics
        )
      }
    }

    const scheduleDraw = () => {
      if (drawFrameRef.current !== null) {
        return
      }
      drawFrameRef.current = requestAnimationFrame(() => {
        drawFrameRef.current = null
        drawCanvas()
      })
    }

    const refreshMetrics = () => {
      metrics = readGraphMetrics()
      scheduleDraw()
    }

    let resolutionQuery: MediaQueryList | null = null
    const bindResolutionQuery = () => {
      resolutionQuery?.removeEventListener('change', refreshResolution)
      resolutionQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`)
      resolutionQuery.addEventListener('change', refreshResolution)
    }
    const refreshResolution = () => {
      bindResolutionQuery()
      scheduleDraw()
    }

    const resizeObserver = new ResizeObserver(refreshMetrics)
    resizeObserver.observe(document.documentElement)
    resizeObserver.observe(scroller)
    bindResolutionQuery()
    window.addEventListener('resize', refreshMetrics)
    scroller.addEventListener('scroll', scheduleDraw, { passive: true })
    drawCanvas()

    return () => {
      resizeObserver.disconnect()
      resolutionQuery?.removeEventListener('change', refreshResolution)
      window.removeEventListener('resize', refreshMetrics)
      scroller.removeEventListener('scroll', scheduleDraw)
      if (drawFrameRef.current !== null) {
        cancelAnimationFrame(drawFrameRef.current)
        drawFrameRef.current = null
      }
    }
  }, [
    props.layout,
    props.scrollContainer,
    props.viewportHeight,
    props.visibleSet,
    props.railWidth,
    props.startIndex,
    props.endIndex,
    props.graphLayoutEndIndex,
    props.themeNonce,
    props.mergeSideRanges
  ])

  return (
    <div
      className="pointer-events-none sticky top-0 z-0"
      style={{ height: '0px' }}
      aria-hidden="true"
    >
      <canvas
        ref={canvasRef}
        data-testid="commit-graph-canvas"
        className="absolute left-0 top-0"
        style={{
          width: `${props.railWidth}px`,
          maxWidth: '100%',
          height: `${props.viewportHeight}px`
        }}
      />
    </div>
  )
}
