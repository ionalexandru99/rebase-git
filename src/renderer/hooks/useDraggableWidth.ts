import { useCallback, useEffect, useRef, useState } from 'react'

interface PaneState {
  open: boolean
  width: number
}

interface UseDraggableWidthOptions {
  min: number
  max: number
  defaultWidth: number
  load?: () => Promise<PaneState>
  save?: (state: PaneState) => void
  decode?: (raw: PaneState) => PaneState
  onLoadError?: (error: unknown) => void
}

interface UseDraggableWidthResult {
  width: number
  isOpen: boolean
  setOpen: (next: boolean) => void
  onResizeStart: (event: React.MouseEvent) => void
}

export function useDraggableWidth({
  min,
  max,
  defaultWidth,
  load,
  save,
  decode,
  onLoadError
}: UseDraggableWidthOptions): UseDraggableWidthResult {
  const [isOpen, setIsOpen] = useState(true)
  const [width, setWidth] = useState(defaultWidth)
  const dragWidthRef = useRef(defaultWidth)

  useEffect(() => {
    if (!load) return
    let cancelled = false
    load()
      .then((raw) => {
        if (cancelled) return
        const decoded = decode ? decode(raw) : raw
        const clamped = Math.max(min, Math.min(max, decoded.width))
        setIsOpen(decoded.open)
        setWidth(clamped)
        dragWidthRef.current = clamped
      })
      .catch((error: unknown) => {
        if (cancelled) return
        onLoadError?.(error)
      })
    return () => {
      cancelled = true
    }
  }, [load, decode, min, max, onLoadError])

  const persist = useCallback(
    (nextOpen: boolean, nextWidth: number) => {
      save?.({ open: nextOpen, width: nextWidth })
    },
    [save]
  )

  const setOpen = useCallback(
    (next: boolean) => {
      setIsOpen(next)
      persist(next, dragWidthRef.current)
    },
    [persist]
  )

  const onResizeStart = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault()
      const startX = event.clientX
      const startWidth = width
      dragWidthRef.current = startWidth
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
      document.body.dataset.sidebarResizing = 'true'
      const onMove = (ev: MouseEvent) => {
        const next = Math.max(min, Math.min(max, startWidth + (ev.clientX - startX)))
        dragWidthRef.current = next
        setWidth(next)
      }
      const onUp = () => {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        delete document.body.dataset.sidebarResizing
        persist(isOpen, dragWidthRef.current)
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [width, isOpen, persist, min, max]
  )

  return { width, isOpen, setOpen, onResizeStart }
}
