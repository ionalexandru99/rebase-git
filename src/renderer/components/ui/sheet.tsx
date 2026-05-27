import { XIcon } from 'lucide-react'
import { createContext, type HTMLAttributes, type ReactNode, useContext, useState } from 'react'
import { cn } from '@/lib/utils'

interface SheetContextValue {
  open: boolean
  setOpen: (open: boolean) => void
}

const SheetContext = createContext<SheetContextValue | null>(null)

function useSheet() {
  return useContext(SheetContext)
}

function Sheet(props: {
  children?: ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const [internalOpen, setInternalOpen] = useState(false)
  const open = props.open ?? internalOpen
  const setOpen = (next: boolean) => {
    setInternalOpen(next)
    props.onOpenChange?.(next)
  }
  return <SheetContext.Provider value={{ open, setOpen }}>{props.children}</SheetContext.Provider>
}

function SheetTrigger(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const context = useSheet()
  return (
    <button
      type="button"
      data-slot="sheet-trigger"
      {...props}
      onClick={(event) => {
        props.onClick?.(event)
        context?.setOpen(true)
      }}
    />
  )
}

function SheetClose(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const context = useSheet()
  return (
    <button
      type="button"
      data-slot="sheet-close"
      {...props}
      onClick={(event) => {
        props.onClick?.(event)
        context?.setOpen(false)
      }}
    />
  )
}

const sideClasses: Record<'top' | 'right' | 'bottom' | 'left', string> = {
  right: 'inset-y-0 right-0 h-full w-3/4 border-l sm:max-w-sm',
  left: 'inset-y-0 left-0 h-full w-3/4 border-r sm:max-w-sm',
  top: 'inset-x-0 top-0 h-auto border-b',
  bottom: 'inset-x-0 bottom-0 h-auto border-t'
}

function SheetContent(
  props: HTMLAttributes<HTMLDivElement> & {
    side?: 'top' | 'right' | 'bottom' | 'left'
    showCloseButton?: boolean
  }
) {
  const context = useSheet()
  const { className, children, side = 'right', showCloseButton = true, ...rest } = props
  if (context && !context.open) {
    return null
  }
  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/50" />
      <div
        data-slot="sheet-content"
        className={cn(
          'fixed z-50 flex flex-col gap-4 bg-background shadow-lg transition ease-in-out',
          sideClasses[side],
          className
        )}
        {...rest}
      >
        {children}
        {showCloseButton ? (
          <SheetClose className="absolute top-4 right-4 rounded-xs opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none">
            <XIcon className="size-4" />
            <span className="sr-only">Close</span>
          </SheetClose>
        ) : null}
      </div>
    </>
  )
}

function SheetHeader(props: HTMLAttributes<HTMLDivElement>) {
  const { className, ...rest } = props
  return (
    <div
      data-slot="sheet-header"
      className={cn('flex flex-col gap-1.5 p-4', className)}
      {...rest}
    />
  )
}

function SheetFooter(props: HTMLAttributes<HTMLDivElement>) {
  const { className, ...rest } = props
  return (
    <div
      data-slot="sheet-footer"
      className={cn('mt-auto flex flex-col gap-2 p-4', className)}
      {...rest}
    />
  )
}

function SheetTitle(props: HTMLAttributes<HTMLHeadingElement>) {
  const { className, ...rest } = props
  return (
    <h2
      data-slot="sheet-title"
      className={cn('font-semibold text-foreground', className)}
      {...rest}
    />
  )
}

function SheetDescription(props: HTMLAttributes<HTMLParagraphElement>) {
  const { className, ...rest } = props
  return (
    <p
      data-slot="sheet-description"
      className={cn('text-sm text-muted-foreground', className)}
      {...rest}
    />
  )
}

export {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger
}
