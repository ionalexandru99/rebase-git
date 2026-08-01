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
  rowCount: number
  paddingStart?: number
  headRow?: number
  mergeSideRanges?: ReadonlyMap<string, MergeSideRange>
}

export function CommitGraphCanvas(props: CommitGraphCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const latest = useLatestRef(props)
  const scheduleDraw = useRef<() => void>(noop)
  const scroller = props.scrollContainer

  useLayoutEffect(() => {
    if (!scroller) {
      return
    }
    const edges = createEdgeBatch()
    const walker = createLaneWalker()
    let frame: number | null = null
    const backgroundColor = readCssVar('--color-background', '#131313')
    const workingCopyColor = readCssVar('--color-orange', '#e6804c')

    const draw = () => {
      const canvas = canvasRef.current
      const ctx = canvas?.getContext('2d')
      if (!canvas || !ctx) {
        return
      }
      const { layout, topology, commits, metrics, viewportHeight, visibleSet, rowCount } =
        latest.current
      const scrollTop = scroller.scrollTop
      const rowHeight = metrics.rowHeight
      const paddingStart = latest.current.paddingStart ?? 0
      const firstRow = Math.max(0, Math.floor((scrollTop - paddingStart) / rowHeight))
      const lastRow = Math.max(
        firstRow,
        Math.min(
          rowCount,
          commits.length,
          Math.ceil((scrollTop + viewportHeight - paddingStart) / rowHeight)
        )
      )

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
        collectRowEdges(
          edges,
          walker,
          topology,
          row,
          paddingStart + row * rowHeight - scrollTop,
          dim,
          metrics
        )
      }
      strokeEdgeBatch(ctx, edges)

      if (paddingStart > 0) {
        const headRow = latest.current.headRow ?? 0
        const headLane = headRow < layout.commitCount ? layout.commitLane[headRow] : 0
        drawWorkingCopyStub(
          ctx,
          laneX(headLane, metrics),
          paddingStart / 2 - scrollTop,
          paddingStart + headRow * rowHeight + rowHeight / 2 - scrollTop,
          workingCopyColor
        )
      }

      const mergeSideRanges = latest.current.mergeSideRanges
      for (let row = firstRow; row < lastRow; row++) {
        const commit = commits[row]
        const lane = layout.commitLane[row]
        const yTop = paddingStart + row * rowHeight - scrollTop
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
            backgroundColor,
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

function drawWorkingCopyStub(
  ctx: CanvasRenderingContext2D,
  x: number,
  topY: number,
  bottomY: number,
  color: string
): void {
  ctx.globalAlpha = 0.9
  ctx.strokeStyle = color
  ctx.lineWidth = 2
  ctx.setLineDash([3, 3])
  ctx.beginPath()
  ctx.moveTo(x, topY)
  ctx.lineTo(x, bottomY)
  ctx.stroke()
  ctx.setLineDash([])
}

function noop() {}
