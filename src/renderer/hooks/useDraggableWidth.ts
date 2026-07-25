import { SIDEBAR_RESIZE_END_EVENT } from '@shared/sidebar-resize'
import { useCallback, useEffect, useRef, useState } from 'react'
import { LAYOUT_RESET_EVENT } from '@/lib/layout'

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
  onResizeStart: (event: MouseEvent) => void
}

function defaultSaveError(error: unknown) {
  console.warn('[useDraggableWidth] save failed', error)
}

export function useDraggableWidth(options: UseDraggableWidthOptions): UseDraggableWidthResult {
  const { min, max, defaultWidth, load, save, decode } = options
  const onLoadError = options.onLoadError
  const onSaveError = options.onSaveError ?? defaultSaveError

  const [isOpen, setIsOpen] = useState(true)
  const [width, setWidth] = useState(defaultWidth)
  const dragWidth = useRef(defaultWidth)
  const dragTeardown = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (!load) {
      return
    }
    let cancelled = false
    load()
      .then((raw) => {
        if (cancelled) {
          return
        }
        const decoded = decode ? decode(raw) : raw
        const clamped = Math.max(min, Math.min(max, decoded.width))
        setIsOpen(decoded.open)
        setWidth(clamped)
        dragWidth.current = clamped
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return
        }
        onLoadError?.(error)
      })
    return () => {
      cancelled = true
    }
  }, [decode, load, max, min, onLoadError])

  useEffect(() => {
    return () => dragTeardown.current?.()
  }, [])

  const persist = useCallback(
    (nextOpen: boolean, nextWidth: number) => {
      const result = save?.({ open: nextOpen, width: nextWidth })
      if (result && typeof (result as Promise<void>).catch === 'function') {
        ;(result as Promise<void>).catch(onSaveError)
      }
    },
    [onSaveError, save]
  )

  const setOpen = (next: boolean) => {
    setIsOpen(next)
    persist(next, dragWidth.current)
  }

  useEffect(() => {
    const reset = () => {
      dragWidth.current = defaultWidth
      setWidth(defaultWidth)
      setIsOpen(true)
      persist(true, defaultWidth)
    }
    window.addEventListener(LAYOUT_RESET_EVENT, reset)
    return () => window.removeEventListener(LAYOUT_RESET_EVENT, reset)
  }, [defaultWidth, persist])

  const onResizeStart = (event: MouseEvent) => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = width
    dragWidth.current = startWidth
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    document.body.dataset.sidebarResizing = 'true'

    let pendingFrame: number | null = null

    const onMove = (moveEvent: MouseEvent) => {
      dragWidth.current = Math.max(min, Math.min(max, startWidth + (moveEvent.clientX - startX)))
      if (pendingFrame !== null) {
        return
      }
      pendingFrame = requestAnimationFrame(() => {
        pendingFrame = null
        setWidth(dragWidth.current)
      })
    }

    const finalize = () => {
      if (!dragTeardown.current) {
        return
      }
      if (pendingFrame !== null) {
        cancelAnimationFrame(pendingFrame)
        pendingFrame = null
      }
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', finalize)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      delete document.body.dataset.sidebarResizing
      dragTeardown.current = null
      setWidth(dragWidth.current)
      persist(isOpen, dragWidth.current)
      window.dispatchEvent(new Event(SIDEBAR_RESIZE_END_EVENT))
    }

    dragTeardown.current = finalize
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', finalize)
  }

  return { width, isOpen, setOpen, onResizeStart }
}
