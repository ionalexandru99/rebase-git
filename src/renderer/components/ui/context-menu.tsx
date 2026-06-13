import { CheckIcon, ChevronRightIcon, CircleIcon } from 'lucide-react'
import {
  createContext,
  type HTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState
} from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'

interface MenuPosition {
  x: number
  y: number
}

interface ContextMenuValue {
  open: boolean
  position: MenuPosition | null
  openAt: (position: MenuPosition) => void
  close: () => void
}

const ContextMenuContext = createContext<ContextMenuValue | null>(null)

function useContextMenu() {
  const context = useContext(ContextMenuContext)
  if (!context) {
    throw new Error('Context menu components must be rendered inside ContextMenu')
  }
  return context
}

function ContextMenu(props: { children?: ReactNode }) {
  const [position, setPosition] = useState<MenuPosition | null>(null)
  const value: ContextMenuValue = {
    open: position !== null,
    position,
    openAt: (next) => setPosition(next),
    close: () => setPosition(null)
  }
  return <ContextMenuContext.Provider value={value}>{props.children}</ContextMenuContext.Provider>
}

function ContextMenuTrigger(
  props: React.ButtonHTMLAttributes<HTMLButtonElement> & { as?: string; children?: ReactNode }
) {
  const { openAt } = useContextMenu()
  const { as: _as, onContextMenu, ...rest } = props
  return (
    <button
      data-slot="context-menu-trigger"
      onContextMenu={(event) => {
        event.preventDefault()
        onContextMenu?.(event)
        openAt({ x: event.clientX, y: event.clientY })
      }}
      {...rest}
    />
  )
}

// A non-button trigger for cases where the right-clickable element must stay a plain element
// (grid rows, list items) rather than a <button>.
function ContextMenuTriggerArea(props: HTMLAttributes<HTMLDivElement> & { children?: ReactNode }) {
  const { openAt } = useContextMenu()
  const { onContextMenu, ...rest } = props
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: contextmenu is a right-click affordance layered on an existing element; keyboard users reach the same actions elsewhere
    <div
      data-slot="context-menu-trigger"
      onContextMenu={(event) => {
        event.preventDefault()
        onContextMenu?.(event)
        openAt({ x: event.clientX, y: event.clientY })
      }}
      {...rest}
    />
  )
}

function ContextMenuGroup(props: HTMLAttributes<HTMLDivElement>) {
  return <div data-slot="context-menu-group" {...props} />
}

const VIEWPORT_MARGIN = 6

function ContextMenuContent(props: HTMLAttributes<HTMLDivElement>) {
  const { open, position, close } = useContextMenu()
  const { className, style, ...rest } = props
  const contentRef = useRef<HTMLDivElement | null>(null)
  const [resolved, setResolved] = useState<MenuPosition | null>(null)

  useLayoutEffect(() => {
    if (!open || !position) {
      setResolved(null)
      return
    }
    const element = contentRef.current
    if (!element) {
      setResolved(position)
      return
    }
    const rect = element.getBoundingClientRect()
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight
    let x = position.x
    let y = position.y
    if (rect.width > 0 && x + rect.width > viewportWidth) {
      x = Math.max(VIEWPORT_MARGIN, viewportWidth - rect.width - VIEWPORT_MARGIN)
    }
    if (rect.height > 0 && y + rect.height > viewportHeight) {
      y = Math.max(VIEWPORT_MARGIN, viewportHeight - rect.height - VIEWPORT_MARGIN)
    }
    setResolved({ x, y })
  }, [open, position])

  useEffect(() => {
    if (!open) {
      return
    }
    const onPointerDown = (event: Event) => {
      const target = event.target as Node | null
      if (target && contentRef.current?.contains(target)) {
        return
      }
      close()
    }
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        close()
      }
    }
    const onDismiss = () => close()
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('resize', onDismiss)
    window.addEventListener('blur', onDismiss)
    window.addEventListener('scroll', onDismiss, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('resize', onDismiss)
      window.removeEventListener('blur', onDismiss)
      window.removeEventListener('scroll', onDismiss, true)
    }
  }, [open, close])

  if (!open || !position) {
    return null
  }

  const placement = resolved ?? position
  return createPortal(
    <div
      ref={contentRef}
      data-slot="context-menu-content"
      role="menu"
      tabIndex={-1}
      style={{ position: 'fixed', left: `${placement.x}px`, top: `${placement.y}px`, ...style }}
      className={cn(
        'z-50 min-w-[10rem] overflow-x-hidden overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md',
        className
      )}
      {...rest}
    />,
    document.body
  )
}

function ContextMenuItem(
  props: HTMLAttributes<HTMLDivElement> & {
    inset?: boolean
    variant?: 'default' | 'destructive'
    disabled?: boolean
    onSelect?: () => void
  }
) {
  const { close } = useContextMenu()
  const {
    className,
    inset,
    variant = 'default',
    disabled,
    onSelect,
    onClick,
    onKeyDown,
    ...rest
  } = props
  const select = () => {
    if (disabled) {
      return
    }
    onSelect?.()
    close()
  }
  const selectFromKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(event)
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      select()
    }
  }
  return (
    <div
      role="menuitem"
      tabIndex={disabled ? -1 : 0}
      data-slot="context-menu-item"
      data-inset={inset}
      data-variant={variant}
      data-disabled={disabled ? '' : undefined}
      aria-disabled={disabled}
      className={cn(
        "relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden focus:bg-accent focus:text-accent-foreground hover:bg-accent hover:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[inset]:pl-8 data-[variant=destructive]:text-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground",
        className
      )}
      onClick={(event) => {
        onClick?.(event)
        select()
      }}
      onKeyDown={selectFromKeyboard}
      {...rest}
    />
  )
}

function ContextMenuCheckboxItem(
  props: Omit<HTMLAttributes<HTMLDivElement>, 'onSelect'> & { onSelect?: () => void }
) {
  const { className, children, onSelect, ...rest } = props
  return (
    <ContextMenuItem className={cn('pl-8', className)} onSelect={onSelect} {...rest}>
      <span className="pointer-events-none absolute left-2 flex size-3.5 items-center justify-center">
        <CheckIcon className="size-4" />
      </span>
      {children}
    </ContextMenuItem>
  )
}

function ContextMenuRadioGroup(props: HTMLAttributes<HTMLDivElement>) {
  return <div data-slot="context-menu-radio-group" {...props} />
}

function ContextMenuRadioItem(
  props: Omit<HTMLAttributes<HTMLDivElement>, 'onSelect'> & { onSelect?: () => void }
) {
  const { className, children, onSelect, ...rest } = props
  return (
    <ContextMenuItem className={cn('pl-8', className)} onSelect={onSelect} {...rest}>
      <span className="pointer-events-none absolute left-2 flex size-3.5 items-center justify-center">
        <CircleIcon className="size-2 fill-current" />
      </span>
      {children}
    </ContextMenuItem>
  )
}

function ContextMenuLabel(props: HTMLAttributes<HTMLDivElement> & { inset?: boolean }) {
  const { className, inset, ...rest } = props
  return (
    <div
      data-slot="context-menu-label"
      data-inset={inset}
      className={cn(
        'px-2 py-1.5 text-xs font-medium text-muted-foreground data-[inset]:pl-8',
        className
      )}
      {...rest}
    />
  )
}

function ContextMenuSeparator(props: HTMLAttributes<HTMLDivElement>) {
  const { className, ...rest } = props
  return (
    <div
      data-slot="context-menu-separator"
      className={cn('-mx-1 my-1 h-px bg-border', className)}
      {...rest}
    />
  )
}

function ContextMenuShortcut(props: HTMLAttributes<HTMLSpanElement>) {
  const { className, ...rest } = props
  return (
    <span
      data-slot="context-menu-shortcut"
      className={cn('ml-auto text-xs tracking-widest text-muted-foreground', className)}
      {...rest}
    />
  )
}

function ContextMenuSub(props: { children?: ReactNode }) {
  return <>{props.children}</>
}

function ContextMenuSubTrigger(props: HTMLAttributes<HTMLDivElement> & { inset?: boolean }) {
  const { className, inset, children, ...rest } = props
  return (
    <div
      data-slot="context-menu-sub-trigger"
      data-inset={inset}
      className={cn(
        "flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden data-[inset]:pl-8 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground",
        className
      )}
      {...rest}
    >
      {children}
      <ChevronRightIcon className="ml-auto size-4" />
    </div>
  )
}

function ContextMenuSubContent(props: HTMLAttributes<HTMLDivElement>) {
  const { className, ...rest } = props
  return (
    <div
      data-slot="context-menu-sub-content"
      className={cn(
        'z-50 min-w-[8rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-lg',
        className
      )}
      {...rest}
    />
  )
}

export {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
  ContextMenuTriggerArea
}
