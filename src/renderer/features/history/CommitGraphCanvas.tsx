import { useLayoutEffect, useRef } from 'react'
import {
  collectRowEdges,
  computeGraphRailWidth,
  createEdgeBatch,
  drawCommitDot,
  drawMergeGlyph,
  laneColor,
  laneX,
  readCssVar,
  resetEdgeBatch,
  strokeEdgeBatch
} from '@/features/history/graph/canvas'
import { createLaneWalker, seekLanes, stepLanes } from '@/features/history/graph/lane-walker'
import type { GraphLayout } from '@/features/history/graph/layout'
import type { GraphMetrics } from '@/features/history/graph/metrics'
import type { GraphTopology } from '@/features/history/graph/topology'
import { useLatestRef } from '@/hooks/useLatestRef'
import type { GitLogEntry } from '@/types'
import type { MergeSideRange } from './selectors'

interface CommitGraphCanvasProps {
  layout: GraphLayout
  topology: GraphTopology
  commits: GitLogEntry[]
  metrics: GraphMetrics
  scrollContainer: HTMLDivElement | undefined
  viewportHeight: number
  visibleSet: Set<string> | null
  themeNonce: number
  // Rows with a layout that matches `commits`; rows past it are left blank until the relayout lands.
  rowCount: number
  mergeSideRanges?: ReadonlyMap<string, MergeSideRange>
}

export function CommitGraphCanvas(props: CommitGraphCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const latest = useLatestRef(props)
  const scheduleDraw = useRef<() => void>(noop)
  const scroller = props.scrollContainer

  // Mounted once per scroll container: the draw reads live props and the live scroll offset, so a
  // scroll never costs a listener rebind, a style read, or a React render.
  useLayoutEffect(() => {
    if (!scroller) {
      return
    }
    const edges = createEdgeBatch()
    const walker = createLaneWalker()
    let frame: number | null = null
    let drawnThemeNonce = -1
    let backgroundColor = '#ffffff'

    const draw = () => {
      const canvas = canvasRef.current
      const ctx = canvas?.getContext('2d')
      if (!canvas || !ctx) {
        return
      }
      const { layout, topology, commits, metrics, viewportHeight, visibleSet, rowCount } =
        latest.current
      if (latest.current.themeNonce !== drawnThemeNonce) {
        drawnThemeNonce = latest.current.themeNonce
        backgroundColor = readCssVar('--color-background', '#ffffff')
      }

      const scrollTop = scroller.scrollTop
      const rowHeight = metrics.rowHeight
      const firstRow = Math.max(0, Math.floor(scrollTop / rowHeight))
      // Bounded by the commits too: a filter can shrink the list a render before the layout catches
      // up, and the rows in between have no commit to draw.
      const lastRow = Math.min(
        rowCount,
        commits.length,
        Math.ceil((scrollTop + viewportHeight) / rowHeight)
      )

      // Only the rows on screen decide how wide the rail has to be, so a deep fan-out further down
      // the log never inflates the bitmap here.
      let laneSpan = 1
      for (let row = firstRow; row < lastRow; row++) {
        laneSpan = Math.max(laneSpan, layout.railLanes[row])
      }
      const railWidth = computeGraphRailWidth(laneSpan, metrics)
      const width = Math.min(railWidth, scroller.clientWidth || railWidth)
      const dpr = window.devicePixelRatio || 1
      const bitmapWidth = Math.max(1, Math.round(width * dpr))
      const bitmapHeight = Math.max(1, Math.round(viewportHeight * dpr))
      if (canvas.width !== bitmapWidth) {
        canvas.width = bitmapWidth
      }
      if (canvas.height !== bitmapHeight) {
        canvas.height = bitmapHeight
      }

      const cssWidth = `${railWidth}px`
      if (canvas.style.width !== cssWidth) {
        canvas.style.width = cssWidth
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, width, viewportHeight)
      ctx.lineCap = 'round'

      resetEdgeBatch(edges)
      seekLanes(walker, layout, topology, firstRow)
      for (let row = firstRow; row < lastRow; row++) {
        stepLanes(walker, topology)
        const dim = !!visibleSet && !visibleSet.has(commits[row].hash)
        collectRowEdges(edges, walker, topology, row, row * rowHeight - scrollTop, dim, metrics)
      }
      strokeEdgeBatch(ctx, edges)

      const mergeSideRanges = latest.current.mergeSideRanges
      for (let row = firstRow; row < lastRow; row++) {
        const commit = commits[row]
        const lane = layout.commitLane[row]
        const yTop = row * rowHeight - scrollTop
        const dim = !!visibleSet && !visibleSet.has(commit.hash)
        drawCommitDot(ctx, lane, commit.parents.length >= 2, yTop, dim, backgroundColor, metrics)
        const glyph = mergeSideRanges?.get(commit.hash)?.glyph
        if (glyph) {
          drawMergeGlyph(
            ctx,
            laneX(lane, metrics),
            yTop + rowHeight / 2,
            glyph,
            laneColor(lane),
            metrics
          )
        }
      }
    }

    const schedule = () => {
      if (frame !== null) {
        return
      }
      frame = requestAnimationFrame(() => {
        frame = null
        draw()
      })
    }
    scheduleDraw.current = schedule

    const resizeObserver = new ResizeObserver(schedule)
    resizeObserver.observe(scroller)
    scroller.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    draw()

    return () => {
      scheduleDraw.current = noop
      resizeObserver.disconnect()
      scroller.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      if (frame !== null) {
        cancelAnimationFrame(frame)
      }
    }
  }, [scroller])

  // The canvas mirrors whatever the props currently say, so any render queues a frame; the request
  // animation frame guard collapses that with the scroll handler into one draw per frame.
  useLayoutEffect(() => {
    scheduleDraw.current()
  })

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
        style={{ maxWidth: '100%', height: `${props.viewportHeight}px` }}
      />
    </div>
  )
}

function noop() {}
