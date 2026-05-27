import { type Accessor, createEffect, onCleanup } from 'solid-js'
import { drawGraphRow, ROW_H, readCssVar } from '@/lib/git-graph/canvas'
import type { RowLayout } from '@/lib/git-graph/layout'

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

function visibleSetRevision(visibleSet: Set<string> | null): string {
  if (!visibleSet) {
    return 'all'
  }
  if (visibleSet.size === 0) {
    return 'none'
  }
  const hashes = [...visibleSet]
  hashes.sort()
  return `${visibleSet.size}:${hashes[0]}:${hashes[hashes.length - 1]}`
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
    void props.themeNonce
    void props.scrollTop
    void props.startIndex
    void props.endIndex
    void props.viewportHeight
    void props.railWidth
    void props.rows.length
    void props.graphLayoutEndIndex
    if (props.graphLayoutEndIndex > 0) {
      const end = Math.min(props.endIndex, props.graphLayoutEndIndex)
      for (let index = props.startIndex; index < end; index++) {
        void props.rows[index]?.commitLane
        void props.rows[index]?.incoming.length
        void props.rows[index]?.outgoing.length
      }
    }
    visibleSetRevision(props.visibleSet)
    scheduleDraw()
  })

  onCleanup(() => {
    if (drawFrame !== null) {
      cancelAnimationFrame(drawFrame)
    }
  })

  return (
    <div class="pointer-events-none sticky top-0 z-20" style={{ height: '0px' }} aria-hidden="true">
      <canvas
        ref={canvas}
        class="absolute left-0 top-0"
        style={{ width: `${props.railWidth}px`, height: `${props.viewportHeight}px` }}
      />
    </div>
  )
}
