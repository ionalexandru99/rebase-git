import { SIDEBAR_RESIZE_END_EVENT } from '@shared/sidebar-resize'
import { type Accessor, createSignal, onCleanup, onMount } from '@/lib/react-compat'

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
  width: Accessor<number>
  isOpen: Accessor<boolean>
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

  const [isOpen, setIsOpen] = createSignal(true)
  const [width, setWidth] = createSignal(defaultWidth)
  let dragWidth = defaultWidth
  let dragTeardown: (() => void) | null = null

  onMount(() => {
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
        dragWidth = clamped
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return
        }
        onLoadError?.(error)
      })
    onCleanup(() => {
      cancelled = true
    })
  })

  onCleanup(() => dragTeardown?.())

  const persist = (nextOpen: boolean, nextWidth: number) => {
    const result = save?.({ open: nextOpen, width: nextWidth })
    if (result && typeof (result as Promise<void>).catch === 'function') {
      ;(result as Promise<void>).catch(onSaveError)
    }
  }

  const setOpen = (next: boolean) => {
    setIsOpen(next)
    persist(next, dragWidth)
  }

  const onResizeStart = (event: MouseEvent) => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = width()
    dragWidth = startWidth
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    document.body.dataset.sidebarResizing = 'true'

    let pendingFrame: number | null = null

    const onMove = (moveEvent: MouseEvent) => {
      dragWidth = Math.max(min, Math.min(max, startWidth + (moveEvent.clientX - startX)))
      if (pendingFrame !== null) {
        return
      }
      pendingFrame = requestAnimationFrame(() => {
        pendingFrame = null
        setWidth(dragWidth)
      })
    }

    const finalize = () => {
      if (!dragTeardown) {
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
      dragTeardown = null
      setWidth(dragWidth)
      persist(isOpen(), dragWidth)
      window.dispatchEvent(new Event(SIDEBAR_RESIZE_END_EVENT))
    }

    dragTeardown = finalize
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', finalize)
  }

  return { width, isOpen, setOpen, onResizeStart }
}
