import { useLayoutEffect, useRef } from 'react'
import {
  collectRowEdges,
  createEdgeBatch,
  drawCommitDot,
  drawMergeGlyph,
  laneColor,
  laneX,
  ROW_H,
  readCssVar,
  strokeEdgeBatch
} from '@/lib/git-graph/canvas'
import type { RowLayout } from '@/lib/git-graph/layout'
import type { GitLogEntry } from '@/types'
import { mergeGlyphState } from './selectors'

const EMPTY_SET: ReadonlySet<string> = new Set()
const NO_COMMITS: GitLogEntry[] = []

interface CommitGraphCanvasProps {
  rows: RowLayout[]
  scrollContainer: HTMLDivElement | undefined
  viewportHeight: number
  visibleSet: Set<string> | null
  railWidth: number
  themeNonce: number
  startIndex: number
  endIndex: number
  graphLayoutEndIndex: number
  allCommits?: GitLogEntry[]
  displayedSet?: ReadonlySet<string>
  expandedMerges?: ReadonlySet<string>
}

export function CommitGraphCanvas(props: CommitGraphCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawFrameRef = useRef<number | null>(null)

  useLayoutEffect(() => {
    const scroller = props.scrollContainer
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
    void props.themeNonce
    const bgColor = readCssVar('--color-background', '#ffffff')
    const drawCanvas = () => {
      const canvas = canvasRef.current
      if (!canvas || !scroller) {
        return
      }
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        return
      }

      const rows = props.rows
      const viewportHeight = props.viewportHeight
      const visible = props.visibleSet
      const railWidth = props.railWidth
      const liveScrollTop = scroller.scrollTop
      const graphLayoutEndIndex = props.graphLayoutEndIndex

      const bitmapW = Math.max(1, Math.round(railWidth * dpr))
      const bitmapH = Math.max(1, Math.round(viewportHeight * dpr))
      if (canvas.width !== bitmapW) {
        canvas.width = bitmapW
      }
      if (canvas.height !== bitmapH) {
        canvas.height = bitmapH
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, railWidth, viewportHeight)
      ctx.lineCap = 'round'

      const start = props.startIndex
      const end = props.endIndex
      const allCommits = props.allCommits ?? NO_COMMITS
      const displayedSet = props.displayedSet ?? EMPTY_SET
      const expandedMerges = props.expandedMerges ?? EMPTY_SET

      const edgeBatch = createEdgeBatch()
      const dots: { row: RowLayout; yTop: number; dim: boolean }[] = []
      for (let index = start; index < end; index++) {
        if (index >= graphLayoutEndIndex) {
          continue
        }
        const row = rows[index]
        if (!row) {
          continue
        }
        const yTop = index * ROW_H - liveScrollTop
        if (yTop + ROW_H < 0 || yTop > viewportHeight) {
          continue
        }
        const dim = !!(visible && !visible.has(row.commit.hash))
        collectRowEdges(edgeBatch, row, yTop, index === 0, dim)
        dots.push({ row, yTop, dim })
      }

      strokeEdgeBatch(ctx, edgeBatch)
      for (const dot of dots) {
        drawCommitDot(ctx, dot.row, dot.yTop, dot.dim, bgColor)
        if (dot.row.commit.parents.length < 2 || allCommits.length === 0) {
          continue
        }
        const glyph = mergeGlyphState(allCommits, dot.row.commit, displayedSet, expandedMerges)
        if (glyph === 'none') {
          continue
        }
        drawMergeGlyph(
          ctx,
          laneX(dot.row.commitLane),
          dot.yTop + ROW_H / 2,
          glyph,
          laneColor(dot.row.commitLane)
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

    // Draw synchronously before paint so the dots land in the same frame as the rows they sit on;
    // a toggle that changes row positions never shows a frame of stale/misaligned dots. Live
    // scrolling stays on rAF, which only updates scrollTop and never restructures the rows.
    drawCanvas()
    scroller?.addEventListener('scroll', scheduleDraw, { passive: true })

    return () => {
      scroller?.removeEventListener('scroll', scheduleDraw)
      if (drawFrameRef.current !== null) {
        cancelAnimationFrame(drawFrameRef.current)
        drawFrameRef.current = null
      }
    }
  }, [
    props.rows,
    props.scrollContainer,
    props.viewportHeight,
    props.visibleSet,
    props.railWidth,
    props.startIndex,
    props.endIndex,
    props.graphLayoutEndIndex,
    props.themeNonce,
    props.allCommits,
    props.displayedSet,
    props.expandedMerges
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
        style={{ width: `${props.railWidth}px`, height: `${props.viewportHeight}px` }}
      />
    </div>
  )
}
