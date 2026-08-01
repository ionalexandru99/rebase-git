import { SIDEBAR_RESIZE_END_EVENT } from '@shared/sidebar-resize'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useLatestRef } from '@/hooks/useLatestRef'
import { LAYOUT_RESET_EVENT } from '@/lib/layout'

interface PaneState {
  open: boolean
  size: number
}

type PaneAxis = 'horizontal' | 'vertical'

type PaneHandle = 'start' | 'end'

interface UseDraggablePaneOptions {
  min: number
  max: number
  defaultSize: number
  axis?: PaneAxis
  handle?: PaneHandle
  load?: () => Promise<PaneState>
  save?: (state: PaneState) => void | Promise<void>
  onLoadError?: (error: unknown) => void
  onSaveError?: (error: unknown) => void
}

interface UseDraggablePaneResult {
  size: number
  isOpen: boolean
  loaded: boolean
  setOpen: (next: boolean) => void
  reset: () => void
  onResizeStart: (event: MouseEvent) => void
}

function defaultSaveError(error: unknown) {
  console.warn('[useDraggablePane] save failed', error)
}

export function useDraggablePane(options: UseDraggablePaneOptions): UseDraggablePaneResult {
  const { min, max, defaultSize, load, save } = options
  const axis = options.axis ?? 'horizontal'
  const handle = options.handle ?? 'end'
  const onLoadError = options.onLoadError
  const onSaveError = options.onSaveError ?? defaultSaveError

  const [isOpen, setIsOpen] = useState(true)
  const [size, setSize] = useState(defaultSize)
  const [loaded, setLoaded] = useState(!load)
  const dragSize = useRef(defaultSize)
  const dragTeardown = useRef<(() => void) | null>(null)
  const userAdjusted = useRef(false)

  useEffect(() => {
    if (!load) {
      return
    }
    let cancelled = false
    load()
      .then((loadedState) => {
        if (cancelled) {
          return
        }
        if (userAdjusted.current) {
          setLoaded(true)
          return
        }
        const clamped = Math.max(min, Math.min(max, loadedState.size))
        setIsOpen(loadedState.open)
        setSize(clamped)
        dragSize.current = clamped
        setLoaded(true)
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return
        }
        onLoadError?.(error)
        setLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [load, max, min, onLoadError])

  useEffect(() => {
    return () => dragTeardown.current?.()
  }, [])

  const latestPersistHandlers = useLatestRef({ save, onSaveError })

  const persist = useCallback((nextOpen: boolean, nextSize: number) => {
    const { save: saveState, onSaveError: reportSaveError } = latestPersistHandlers.current
    const result = saveState?.({ open: nextOpen, size: nextSize })
    if (result && typeof (result as Promise<void>).catch === 'function') {
      ;(result as Promise<void>).catch(reportSaveError)
    }
  }, [])

  const setOpen = (next: boolean) => {
    userAdjusted.current = true
    setIsOpen(next)
    persist(next, dragSize.current)
  }

  const reset = useCallback(() => {
    userAdjusted.current = true
    dragSize.current = defaultSize
    setSize(defaultSize)
    setIsOpen(true)
    persist(true, defaultSize)
  }, [defaultSize, persist])

  useEffect(() => {
    window.addEventListener(LAYOUT_RESET_EVENT, reset)
    return () => window.removeEventListener(LAYOUT_RESET_EVENT, reset)
  }, [reset])

  const onResizeStart = (event: MouseEvent) => {
    event.preventDefault()
    userAdjusted.current = true
    const vertical = axis === 'vertical'
    const startPosition = vertical ? event.clientY : event.clientX
    const startSize = size
    const direction = handle === 'start' ? -1 : 1
    dragSize.current = startSize
    document.body.style.cursor = vertical ? 'row-resize' : 'col-resize'
    document.body.style.userSelect = 'none'
    document.body.dataset.sidebarResizing = 'true'

    let pendingFrame: number | null = null

    const onMove = (moveEvent: MouseEvent) => {
      const position = vertical ? moveEvent.clientY : moveEvent.clientX
      dragSize.current = Math.max(
        min,
        Math.min(max, startSize + direction * (position - startPosition))
      )
      if (pendingFrame !== null) {
        return
      }
      pendingFrame = requestAnimationFrame(() => {
        pendingFrame = null
        setSize(dragSize.current)
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
      setSize(dragSize.current)
      persist(isOpen, dragSize.current)
      window.dispatchEvent(new Event(SIDEBAR_RESIZE_END_EVENT))
    }

    dragTeardown.current = finalize
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', finalize)
  }

  return { size, isOpen, loaded, setOpen, reset, onResizeStart }
}
