import { CheckIcon, ChevronRightIcon, CircleIcon } from 'lucide-react'
import {
  type ButtonHTMLAttributes,
  createContext,
  forwardRef,
  type HTMLAttributes,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type RefObject,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState
} from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'
import { usePortalContainer } from './portal-container'

interface MenuContextValue {
  open: boolean
  setOpen: (open: boolean) => void
  triggerRef: RefObject<HTMLButtonElement | null>
}

const MenuContext = createContext<MenuContextValue | null>(null)

function useMenuContext() {
  const context = useContext(MenuContext)
  if (!context) {
    throw new Error('Dropdown menu components must be rendered inside DropdownMenu')
  }
  return context
}

function DropdownMenu(props: { children?: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  return (
    <MenuContext.Provider value={{ open, setOpen, triggerRef }}>
      <div className={cn('relative', props.className)}>{props.children}</div>
    </MenuContext.Provider>
  )
}

const DropdownMenuTrigger = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { children?: ReactNode }
>((props, forwardedRef) => {
  const { setOpen, open, triggerRef } = useMenuContext()
  const openedOnPointerDown = useRef(false)
  const { onClick, onPointerDown, ...rest } = props
  return (
    <button
      ref={(element) => {
        triggerRef.current = element
        if (typeof forwardedRef === 'function') {
          forwardedRef(element)
        } else if (forwardedRef) {
          forwardedRef.current = element
        }
      }}
      type="button"
      aria-haspopup="menu"
      aria-expanded={open}
      data-slot="dropdown-menu-trigger"
      onPointerDown={(event) => {
        onPointerDown?.(event)
        if (!event.defaultPrevented && event.pointerType !== 'touch' && event.button === 0) {
          openedOnPointerDown.current = true
          setOpen(!open)
        }
      }}
      onClick={(event) => {
        onClick?.(event)
        if (openedOnPointerDown.current) {
          openedOnPointerDown.current = false
          return
        }
        if (!event.defaultPrevented) {
          setOpen(!open)
        }
      }}
      {...rest}
    />
  )
})
DropdownMenuTrigger.displayName = 'DropdownMenuTrigger'

function DropdownMenuGroup(props: HTMLAttributes<HTMLDivElement>) {
  return <div data-slot="dropdown-menu-group" {...props} />
}

const VIEWPORT_MARGIN = 6

function DropdownMenuContent(
  props: HTMLAttributes<HTMLDivElement> & {
    gutter?: number
    portal?: boolean
    align?: 'start' | 'end'
  }
) {
  const portalContainer = usePortalContainer()
  const { open, setOpen, triggerRef } = useMenuContext()
  const { className, gutter = 4, portal = false, align = 'end', style, ...rest } = props
  const contentRef = useRef<HTMLDivElement | null>(null)
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)

  useLayoutEffect(() => {
    if (!open || !portal) {
      setPosition(null)
      return
    }
    const trigger = triggerRef.current
    const content = contentRef.current
    if (!trigger || !content) {
      return
    }
    const triggerRect = trigger.getBoundingClientRect()
    const contentRect = content.getBoundingClientRect()
    let left = align === 'start' ? triggerRect.left : triggerRect.right - contentRect.width
    let top = triggerRect.bottom + gutter
    left = Math.max(
      VIEWPORT_MARGIN,
      Math.min(left, window.innerWidth - contentRect.width - VIEWPORT_MARGIN)
    )
    if (top + contentRect.height > window.innerHeight - VIEWPORT_MARGIN) {
      top = Math.max(VIEWPORT_MARGIN, triggerRect.top - contentRect.height - gutter)
    }
    setPosition({ top, left })
  }, [align, gutter, open, portal, triggerRef])

  useEffect(() => {
    if (!open) {
      return
    }
    const onPointerDown = (event: Event) => {
      const target = event.target as Node | null
      if (
        target &&
        (contentRef.current?.contains(target) || triggerRef.current?.contains(target))
      ) {
        return
      }
      setOpen(false)
    }
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }
    const dismiss = () => setOpen(false)
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('resize', dismiss)
    window.addEventListener('blur', dismiss)
    window.addEventListener('scroll', dismiss, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('resize', dismiss)
      window.removeEventListener('blur', dismiss)
      window.removeEventListener('scroll', dismiss, true)
    }
  }, [open, setOpen, triggerRef])

  if (!open) {
    return null
  }
  const content = (
    <div
      ref={contentRef}
      data-slot="dropdown-menu-content"
      role="menu"
      style={
        portal ? { position: 'fixed', top: position?.top, left: position?.left, ...style } : style
      }
      className={cn(
        'scroll-host z-50 max-h-[60vh] min-w-[12rem] overflow-x-hidden overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md',
        !portal &&
          (align === 'start'
            ? 'absolute left-0 top-[calc(100%+4px)]'
            : 'absolute right-0 top-[calc(100%+4px)]'),
        className
      )}
      {...rest}
    />
  )
  return portal ? createPortal(content, portalContainer) : content
}

function DropdownMenuItem(
  props: ButtonHTMLAttributes<HTMLButtonElement> & {
    inset?: boolean
    variant?: 'default' | 'destructive'
    onSelect?: () => void
  }
) {
  const { setOpen } = useMenuContext()
  const selectedOnPointerUp = useRef(false)
  const {
    className,
    inset,
    variant = 'default',
    onSelect,
    onClick,
    onPointerUp,
    onKeyDown,
    disabled,
    ...rest
  } = props
  const select = (event: MouseEvent<HTMLButtonElement>) => {
    if (disabled) {
      return
    }
    onClick?.(event)
    onSelect?.()
    setOpen(false)
  }
  const selectFromKeyboard = (event: KeyboardEvent<HTMLButtonElement>) => {
    onKeyDown?.(event)
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onSelect?.()
      setOpen(false)
    }
  }
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      data-disabled={disabled ? '' : undefined}
      data-slot="dropdown-menu-item"
      data-inset={inset}
      data-variant={variant}
      className={cn(
        "relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[inset]:pl-8 data-[variant=destructive]:text-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground",
        className
      )}
      onClick={(event) => {
        if (selectedOnPointerUp.current) {
          selectedOnPointerUp.current = false
          return
        }
        select(event)
      }}
      onPointerUp={(event) => {
        onPointerUp?.(event)
        if (!event.defaultPrevented && event.button === 0 && !disabled) {
          selectedOnPointerUp.current = true
          onSelect?.()
          setOpen(false)
        }
      }}
      onKeyDown={selectFromKeyboard}
      {...rest}
    />
  )
}

function DropdownMenuCheckboxItem(
  props: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onSelect'> & { onSelect?: () => void }
) {
  const { className, children, onSelect, ...rest } = props
  return (
    <DropdownMenuItem className={cn('pl-8', className)} onSelect={onSelect} {...rest}>
      <span className="pointer-events-none absolute left-2 flex size-3.5 items-center justify-center">
        <CheckIcon className="size-4" />
      </span>
      {children}
    </DropdownMenuItem>
  )
}

function DropdownMenuRadioGroup(props: HTMLAttributes<HTMLDivElement>) {
  return <div data-slot="dropdown-menu-radio-group" {...props} />
}

function DropdownMenuRadioItem(
  props: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onSelect'> & { onSelect?: () => void }
) {
  const { className, children, onSelect, ...rest } = props
  return (
    <DropdownMenuItem className={cn('pl-8', className)} onSelect={onSelect} {...rest}>
      <span className="pointer-events-none absolute left-2 flex size-3.5 items-center justify-center">
        <CircleIcon className="size-2 fill-current" />
      </span>
      {children}
    </DropdownMenuItem>
  )
}

function DropdownMenuLabel(props: HTMLAttributes<HTMLDivElement> & { inset?: boolean }) {
  const { className, inset, ...rest } = props
  return (
    <div
      data-slot="dropdown-menu-label"
      data-inset={inset}
      className={cn('px-2 py-1.5 text-sm font-medium data-[inset]:pl-8', className)}
      {...rest}
    />
  )
}

function DropdownMenuSeparator(props: HTMLAttributes<HTMLDivElement>) {
  const { className, ...rest } = props
  return (
    <div
      data-slot="dropdown-menu-separator"
      className={cn('-mx-1 my-1 h-px bg-border', className)}
      {...rest}
    />
  )
}

function DropdownMenuShortcut(props: HTMLAttributes<HTMLSpanElement>) {
  const { className, ...rest } = props
  return (
    <span
      data-slot="dropdown-menu-shortcut"
      className={cn('ml-auto text-xs tracking-widest text-muted-foreground', className)}
      {...rest}
    />
  )
}

function DropdownMenuSub(props: { children?: ReactNode }) {
  return <>{props.children}</>
}

function DropdownMenuSubTrigger(props: HTMLAttributes<HTMLDivElement> & { inset?: boolean }) {
  const { className, inset, children, ...rest } = props
  return (
    <div
      data-slot="dropdown-menu-sub-trigger"
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

function DropdownMenuSubContent(props: HTMLAttributes<HTMLDivElement>) {
  const { className, ...rest } = props
  return (
    <div
      data-slot="dropdown-menu-sub-content"
      className={cn(
        'z-50 min-w-[8rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-lg',
        className
      )}
      {...rest}
    />
  )
}

export {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
}
