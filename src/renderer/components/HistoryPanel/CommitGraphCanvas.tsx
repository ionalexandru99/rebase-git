import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react'
import { drawGraphRow, OVERSCAN, ROW_H, readCssVar } from '@/lib/git-graph/canvas'
import type { RowLayout } from '@/lib/git-graph/layout'

export interface CommitGraphCanvasHandle {
  redraw: () => void
}

interface CommitGraphCanvasProps {
  rows: RowLayout[]
  scrollContainerRef: React.RefObject<HTMLDivElement | null>
  viewportHeight: number
  visibleSet: Set<string> | null
  railWidth: number
  themeNonce: number
}

export const CommitGraphCanvas = forwardRef<CommitGraphCanvasHandle, CommitGraphCanvasProps>(
  function CommitGraphCanvas(
    { rows, scrollContainerRef, viewportHeight, visibleSet, railWidth, themeNonce },
    ref
  ) {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const drawDataRef = useRef({ rows, viewportHeight, visibleSet, railWidth })
    drawDataRef.current = { rows, viewportHeight, visibleSet, railWidth }

    const drawCanvas = useCallback(() => {
      const canvas = canvasRef.current
      const scroller = scrollContainerRef.current
      if (!canvas || !scroller) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return

      const {
        rows: currentRows,
        viewportHeight: vh,
        visibleSet: visible,
        railWidth: rw
      } = drawDataRef.current
      const liveScrollTop = scroller.scrollTop

      const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
      const bitmapW = Math.max(1, Math.round(rw * dpr))
      const bitmapH = Math.max(1, Math.round(vh * dpr))
      if (canvas.width !== bitmapW) canvas.width = bitmapW
      if (canvas.height !== bitmapH) canvas.height = bitmapH

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, rw, vh)
      ctx.lineCap = 'round'

      const bgColor = readCssVar('--color-background', '#ffffff')
      const mergeColor = readCssVar('--color-chart-3', '#f59e0b')

      const start = Math.max(0, Math.floor(liveScrollTop / ROW_H) - OVERSCAN)
      const end = Math.min(currentRows.length, Math.ceil((liveScrollTop + vh) / ROW_H) + OVERSCAN)

      for (let i = start; i < end; i++) {
        const row = currentRows[i]
        if (!row) continue
        const yTop = i * ROW_H - liveScrollTop
        if (yTop + ROW_H < 0 || yTop > vh) continue
        const dim = !!(visible && !visible.has(row.commit.hash))
        drawGraphRow(ctx, row, yTop, i === 0, dim, bgColor, mergeColor)
      }
    }, [scrollContainerRef])

    useImperativeHandle(ref, () => ({ redraw: drawCanvas }), [drawCanvas])

    // biome-ignore lint/correctness/useExhaustiveDependencies: themeNonce drives the redraw when CSS vars change even though it isn't read directly
    useEffect(() => {
      drawCanvas()
    }, [rows, viewportHeight, visibleSet, railWidth, themeNonce, drawCanvas])

    return (
      <div className="pointer-events-none sticky top-0 z-20" style={{ height: 0 }} aria-hidden>
        <canvas
          ref={canvasRef}
          className="absolute left-0 top-0"
          style={{ width: railWidth, height: viewportHeight }}
        />
      </div>
    )
  }
)
