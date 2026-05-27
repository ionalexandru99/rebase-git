import { CheckIcon, ChevronRightIcon, CircleIcon } from 'lucide-react'
import {
  createContext,
  type HTMLAttributes,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useContext,
  useState
} from 'react'
import { cn } from '@/lib/utils'

interface MenuContextValue {
  open: boolean
  setOpen: (open: boolean) => void
}

const MenuContext = createContext<MenuContextValue | null>(null)

function useMenuContext() {
  const context = useContext(MenuContext)
  if (!context) {
    throw new Error('Dropdown menu components must be rendered inside DropdownMenu')
  }
  return context
}

function DropdownMenu(props: { children?: ReactNode }) {
  const [open, setOpen] = useState(false)
  return <MenuContext.Provider value={{ open, setOpen }}>{props.children}</MenuContext.Provider>
}

function DropdownMenuTrigger(
  props: React.ButtonHTMLAttributes<HTMLButtonElement> & { children?: ReactNode }
) {
  const { setOpen, open } = useMenuContext()
  const { onClick, onPointerDown, ...rest } = props
  const toggle = () => setOpen(!open)
  return (
    <button
      type="button"
      aria-haspopup="true"
      aria-expanded={open}
      data-slot="dropdown-menu-trigger"
      onPointerDown={(event) => {
        onPointerDown?.(event)
        if (event.pointerType !== 'touch' && event.button === 0) {
          toggle()
        }
      }}
      onClick={(event) => {
        onClick?.(event)
        if ((event.currentTarget as HTMLButtonElement).dataset.pointerType === 'touch') {
          toggle()
        }
      }}
      {...rest}
    />
  )
}

function DropdownMenuGroup(props: HTMLAttributes<HTMLDivElement>) {
  return <div data-slot="dropdown-menu-group" {...props} />
}

function DropdownMenuContent(props: HTMLAttributes<HTMLDivElement> & { gutter?: number }) {
  const { open } = useMenuContext()
  const { className, gutter: _gutter, ...rest } = props
  if (!open) {
    return null
  }
  return (
    <div
      data-slot="dropdown-menu-content"
      role="menu"
      className={cn(
        'z-50 min-w-[8rem] overflow-x-hidden overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md',
        className
      )}
      {...rest}
    />
  )
}

function DropdownMenuItem(
  props: HTMLAttributes<HTMLDivElement> & {
    inset?: boolean
    variant?: 'default' | 'destructive'
    onSelect?: () => void
  }
) {
  const { setOpen } = useMenuContext()
  const {
    className,
    inset,
    variant = 'default',
    onSelect,
    onPointerUp,
    onClick,
    onKeyDown,
    ...rest
  } = props
  const select = (event: MouseEvent<HTMLDivElement>) => {
    onClick?.(event)
    onSelect?.()
    setOpen(false)
  }
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
      data-slot="dropdown-menu-item"
      data-inset={inset}
      data-variant={variant}
      className={cn(
        "relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[inset]:pl-8 data-[variant=destructive]:text-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground",
        className
      )}
      onPointerUp={(event) => {
        onPointerUp?.(event)
        if (event.button === 0) {
          select(event)
        }
      }}
      onClick={select}
      onKeyDown={selectFromKeyboard}
      {...rest}
    />
  )
}

function DropdownMenuCheckboxItem(
  props: Omit<HTMLAttributes<HTMLDivElement>, 'onSelect'> & { onSelect?: () => void }
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
  props: Omit<HTMLAttributes<HTMLDivElement>, 'onSelect'> & { onSelect?: () => void }
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
