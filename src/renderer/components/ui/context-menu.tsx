import { CheckIcon, ChevronRightIcon, CircleIcon } from 'lucide-react'
import {
  createContext,
  type HTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  useContext,
  useState
} from 'react'
import { cn } from '@/lib/utils'

interface ContextMenuValue {
  open: boolean
  setOpen: (open: boolean) => void
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
  const [open, setOpen] = useState(false)
  return (
    <ContextMenuContext.Provider value={{ open, setOpen }}>
      {props.children}
    </ContextMenuContext.Provider>
  )
}

function ContextMenuTrigger(
  props: React.ButtonHTMLAttributes<HTMLButtonElement> & { as?: string; children?: ReactNode }
) {
  const { setOpen } = useContextMenu()
  const { as: _as, onContextMenu, ...rest } = props
  return (
    <button
      data-slot="context-menu-trigger"
      onContextMenu={(event) => {
        event.preventDefault()
        onContextMenu?.(event)
        setOpen(true)
      }}
      {...rest}
    />
  )
}

function ContextMenuGroup(props: HTMLAttributes<HTMLDivElement>) {
  return <div data-slot="context-menu-group" {...props} />
}

function ContextMenuContent(props: HTMLAttributes<HTMLDivElement>) {
  const { open } = useContextMenu()
  const { className, ...rest } = props
  if (!open) {
    return null
  }
  return (
    <div
      data-slot="context-menu-content"
      role="menu"
      className={cn(
        'z-50 min-w-[8rem] overflow-x-hidden overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md',
        className
      )}
      {...rest}
    />
  )
}

function ContextMenuItem(
  props: HTMLAttributes<HTMLDivElement> & {
    inset?: boolean
    variant?: 'default' | 'destructive'
    onSelect?: () => void
  }
) {
  const { setOpen } = useContextMenu()
  const { className, inset, variant = 'default', onSelect, onClick, onKeyDown, ...rest } = props
  const selectFromKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(event)
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onSelect?.()
      setOpen(false)
    }
  }
  return (
    <div
      role="menuitem"
      tabIndex={0}
      data-slot="context-menu-item"
      data-inset={inset}
      data-variant={variant}
      className={cn(
        "relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[inset]:pl-8 data-[variant=destructive]:text-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground",
        className
      )}
      onClick={(event) => {
        onClick?.(event)
        onSelect?.()
        setOpen(false)
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
      className={cn('px-2 py-1.5 text-sm font-medium text-foreground data-[inset]:pl-8', className)}
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
  ContextMenuTrigger
}
