import { drawGraphRow, ROW_H, readCssVar } from '@/lib/git-graph/canvas'
import type { RowLayout } from '@/lib/git-graph/layout'
import { type Accessor, createEffect, onCleanup } from '@/lib/react-compat'

interface CommitGraphCanvasProps {
  rows: RowLayout[]
  scrollContainer: Accessor<HTMLDivElement | undefined>
  viewportHeight: number
  visibleSet: Set<string> | null
  railWidth: number
  themeNonce: number
  scrollTop: number
  startIndex: number
  endIndex: number
  graphLayoutEndIndex: number
}

export function CommitGraphCanvas(props: CommitGraphCanvasProps) {
  let canvas: HTMLCanvasElement | undefined
  let drawFrame: number | null = null

  const drawCanvas = () => {
    const scroller = props.scrollContainer()
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

    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
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

    const bgColor = readCssVar('--color-background', '#ffffff')
    const mergeColor = readCssVar('--color-chart-3', '#f59e0b')

    const start = props.startIndex
    const end = props.endIndex

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
      drawGraphRow(ctx, row, yTop, index === 0, dim, bgColor, mergeColor)
    }
  }

  const scheduleDraw = () => {
    if (drawFrame !== null) {
      return
    }
    drawFrame = requestAnimationFrame(() => {
      drawFrame = null
      drawCanvas()
    })
  }

  createEffect(() => {
    scheduleDraw()
  })

  onCleanup(() => {
    if (drawFrame !== null) {
      cancelAnimationFrame(drawFrame)
    }
  })

  return (
    <div
      className="pointer-events-none sticky top-0 z-20"
      style={{ height: '0px' }}
      aria-hidden="true"
    >
      <canvas
        ref={(node) => {
          canvas = node ?? undefined
        }}
        className="absolute left-0 top-0"
        style={{ width: `${props.railWidth}px`, height: `${props.viewportHeight}px` }}
      />
    </div>
  )
}
