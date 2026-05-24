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
  save?: (state: PaneState) => void | Promise<void>
  decode?: (raw: PaneState) => PaneState
  onLoadError?: (error: unknown) => void
  onSaveError?: (error: unknown) => void
}

interface UseDraggableWidthResult {
  width: number
  isOpen: boolean
  setOpen: (next: boolean) => void
  onResizeStart: (event: React.MouseEvent) => void
}

function defaultSaveError(error: unknown) {
  console.warn('[useDraggableWidth] save failed', error)
}

export function useDraggableWidth({
  min,
  max,
  defaultWidth,
  load,
  save,
  decode,
  onLoadError,
  onSaveError = defaultSaveError
}: UseDraggableWidthOptions): UseDraggableWidthResult {
  const [isOpen, setIsOpen] = useState(true)
  const [width, setWidth] = useState(defaultWidth)
  const dragWidthRef = useRef(defaultWidth)
  const dragTeardownRef = useRef<(() => void) | null>(null)

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

  useEffect(
    () => () => {
      dragTeardownRef.current?.()
    },
    []
  )

  const persist = useCallback(
    (nextOpen: boolean, nextWidth: number) => {
      const result = save?.({ open: nextOpen, width: nextWidth })
      if (result && typeof (result as Promise<void>).catch === 'function') {
        ;(result as Promise<void>).catch(onSaveError)
      }
    },
    [save, onSaveError]
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

      const finalize = () => {
        if (!dragTeardownRef.current) return
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', finalize)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        delete document.body.dataset.sidebarResizing
        dragTeardownRef.current = null
        persist(isOpen, dragWidthRef.current)
      }

      dragTeardownRef.current = finalize
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', finalize)
    },
    [width, isOpen, persist, min, max]
  )

  return { width, isOpen, setOpen, onResizeStart }
}
