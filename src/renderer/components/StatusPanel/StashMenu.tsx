import { type StashEntry, StashListResponseSchema } from '@shared/schemas/ipc'
import { SidecarOp } from '@shared/sidecar-ops'
import { Archive } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { GitActions } from '@/hooks/git/useGitActions'
import { createQuery, useQueryClient } from '@/lib/react-query-compat'
import { sidecarFetch } from '@/lib/sidecar-fetch'
import { cn } from '@/lib/utils'

const stashKey = (repoPath: string) => ['stashes', repoPath] as const
const VIEWPORT_MARGIN = 6

interface StashMenuProps {
  repoPath: string | null
  actions: GitActions
  hasChanges: boolean
}

export function StashMenu(props: StashMenuProps) {
  const queryClient = useQueryClient()
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const [open, setOpen] = useState(false)
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null)

  const query = createQuery<StashEntry[]>(() => {
    const path = props.repoPath
    return {
      queryKey: path ? stashKey(path) : ['stashes', 'idle'],
      enabled: Boolean(path),
      queryFn: async () => {
        if (!path) {
          return []
        }
        const response = await sidecarFetch(
          SidecarOp.stashList,
          { repoPath: path },
          StashListResponseSchema
        )
        return response._tag === 'Ok' ? response.stashes : []
      }
    }
  })

  const stashes = () => query.data ?? []

  const refetchStashes = () => {
    const path = props.repoPath
    if (path) {
      void queryClient.invalidateQueries({ queryKey: stashKey(path) })
    }
  }

  const runAndClose = (operation: Promise<boolean>) => {
    setOpen(false)
    void operation.then(refetchStashes)
  }

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
    let left = triggerRect.left
    let top = triggerRect.bottom + 4
    if (left + menuRect.width > window.innerWidth - VIEWPORT_MARGIN) {
      left = Math.max(VIEWPORT_MARGIN, window.innerWidth - menuRect.width - VIEWPORT_MARGIN)
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

  const itemClass =
    'flex w-full cursor-default select-none items-center rounded-sm px-2 py-1.5 text-left text-sm outline-hidden hover:bg-accent hover:text-accent-foreground'

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : openMenu())}
        className="flex h-7 shrink-0 items-center gap-1 rounded-[var(--r-sm)] border bg-card-2 px-2.5 text-xs text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground"
      >
        <Archive className="size-3.5" />
        Stash
        {stashes().length > 0 ? (
          <span className="rounded-full bg-muted px-1.5 text-[10px]">{stashes().length}</span>
        ) : null}
      </button>
      {open && coords
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              style={{ position: 'fixed', top: `${coords.top}px`, left: `${coords.left}px` }}
              className="z-50 max-h-[60vh] min-w-[14rem] overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
            >
              {props.hasChanges ? (
                <button
                  type="button"
                  role="menuitem"
                  className={itemClass}
                  onClick={() => runAndClose(props.actions.stashPush(undefined, true))}
                >
                  Stash all changes
                </button>
              ) : (
                <div className="px-2 py-1.5 text-xs text-muted-foreground">No changes to stash</div>
              )}
              {stashes().length > 0 ? (
                <>
                  <div className="-mx-1 my-1 h-px bg-border" />
                  <div className="px-2 py-1 text-xs font-medium text-muted-foreground">Stashes</div>
                  {stashes().map((stash) => (
                    <div key={stash.ref} className="flex flex-col">
                      <button
                        type="button"
                        role="menuitem"
                        className={itemClass}
                        onClick={() => runAndClose(props.actions.stashPop(stash.index))}
                      >
                        <span className="min-w-0 truncate">Pop: {stash.message}</span>
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className={cn(itemClass, 'text-destructive')}
                        onClick={() => runAndClose(props.actions.stashDrop(stash.index))}
                      >
                        <span className="min-w-0 truncate">Drop: {stash.message}</span>
                      </button>
                    </div>
                  ))}
                </>
              ) : null}
            </div>,
            document.body
          )
        : null}
    </>
  )
}
