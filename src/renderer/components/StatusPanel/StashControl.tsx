import { Archive, ChevronDown } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

const VIEWPORT_MARGIN = 6

interface StashControlProps {
  stagedFiles: string[]
  hasChanges: boolean
  onStashSelected: (files: string[]) => void
  onStashAll: () => void
}

export function StashControl(props: StashControlProps) {
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const [open, setOpen] = useState(false)
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null)

  const stagedCount = props.stagedFiles.length
  const canStashSelected = stagedCount > 0

  const openMenu = () => {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (rect) {
      setCoords({ top: rect.bottom + 4, left: rect.left })
    }
    setOpen(true)
  }

  useLayoutEffect(() => {
    if (!open) {
      return
    }
    const trigger = triggerRef.current
    const menu = menuRef.current
    if (!trigger || !menu) {
      return
    }
    const triggerRect = trigger.getBoundingClientRect()
    const menuRect = menu.getBoundingClientRect()
    let left = triggerRect.right - menuRect.width
    let top = triggerRect.bottom + 4
    if (left < VIEWPORT_MARGIN) {
      left = VIEWPORT_MARGIN
    }
    if (top + menuRect.height > window.innerHeight - VIEWPORT_MARGIN) {
      top = Math.max(VIEWPORT_MARGIN, triggerRect.top - menuRect.height - 4)
    }
    setCoords({ top, left })
  }, [open])

  useEffect(() => {
    if (!open) {
      return
    }
    const onPointerDown = (event: Event) => {
      const target = event.target as Node | null
      if (target && (menuRef.current?.contains(target) || triggerRef.current?.contains(target))) {
        return
      }
      setOpen(false)
    }
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }
    const onDismiss = () => setOpen(false)
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('resize', onDismiss)
    window.addEventListener('scroll', onDismiss, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('resize', onDismiss)
      window.removeEventListener('scroll', onDismiss, true)
    }
  }, [open])

  const stashSelected = () => props.onStashSelected(props.stagedFiles)
  const stashAll = () => {
    setOpen(false)
    props.onStashAll()
  }

  return (
    <div className="flex h-7 shrink-0 items-stretch overflow-hidden rounded-[var(--r-sm)] border bg-card-2 text-xs text-muted-foreground">
      <button
        type="button"
        disabled={!canStashSelected}
        onClick={stashSelected}
        title={
          canStashSelected
            ? 'Stash the staged files'
            : 'Stage files to stash a selection, or use the menu to stash everything'
        }
        className="flex items-center gap-1 px-2.5 transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Archive className="size-3.5" />
        Stash
        {stagedCount > 0 ? (
          <span className="rounded-full bg-muted px-1.5 text-[10px]">{stagedCount}</span>
        ) : null}
      </button>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="More stash options"
        onClick={() => (open ? setOpen(false) : openMenu())}
        className="flex items-center border-l px-1 transition-colors hover:border-border-strong hover:text-foreground"
      >
        <ChevronDown className="size-3.5" />
      </button>
      {open && coords
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              style={{ position: 'fixed', top: `${coords.top}px`, left: `${coords.left}px` }}
              className="z-50 min-w-[12rem] rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
            >
              <button
                type="button"
                role="menuitem"
                disabled={!props.hasChanges}
                onClick={stashAll}
                className="flex w-full cursor-default select-none items-center rounded-sm px-2 py-1.5 text-left text-sm outline-hidden hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50"
              >
                Stash all changes
              </button>
            </div>,
            document.body
          )
        : null}
    </div>
  )
}
