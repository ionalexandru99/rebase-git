import { XIcon } from 'lucide-react'
import { createContext, type HTMLAttributes, type ReactNode, useContext, useState } from 'react'
import { cn } from '@/lib/utils'
import { Button } from './button'

interface DialogContextValue {
  open: boolean
  setOpen: (open: boolean) => void
}

const DialogContext = createContext<DialogContextValue | null>(null)

function useDialog() {
  return useContext(DialogContext)
}

function Dialog(props: {
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
  return <DialogContext.Provider value={{ open, setOpen }}>{props.children}</DialogContext.Provider>
}

function DialogTrigger(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const context = useDialog()
  return (
    <button
      type="button"
      data-slot="dialog-trigger"
      {...props}
      onClick={(event) => {
        props.onClick?.(event)
        context?.setOpen(true)
      }}
    />
  )
}

function DialogPortal(props: { children?: ReactNode }) {
  return <>{props.children}</>
}

function DialogClose(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const context = useDialog()
  return (
    <button
      type="button"
      data-slot="dialog-close"
      {...props}
      onClick={(event) => {
        props.onClick?.(event)
        context?.setOpen(false)
      }}
    />
  )
}

function DialogOverlay(props: HTMLAttributes<HTMLDivElement>) {
  const { className, ...rest } = props
  return (
    <div
      data-slot="dialog-overlay"
      className={cn('fixed inset-0 z-50 bg-black/50', className)}
      {...rest}
    />
  )
}

function DialogContent(props: HTMLAttributes<HTMLDivElement> & { showCloseButton?: boolean }) {
  const context = useDialog()
  const { className, children, showCloseButton = true, ...rest } = props
  if (context && !context.open) {
    return null
  }
  return (
    <DialogPortal>
      <DialogOverlay />
      <div
        data-slot="dialog-content"
        className={cn(
          'fixed top-[50%] left-[50%] z-50 grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-lg border bg-background p-6 shadow-lg outline-none sm:max-w-lg',
          className
        )}
        {...rest}
      >
        {children}
        {showCloseButton ? (
          <DialogClose className="absolute top-4 right-4 rounded-xs opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4">
            <XIcon />
            <span className="sr-only">Close</span>
          </DialogClose>
        ) : null}
      </div>
    </DialogPortal>
  )
}

function DialogHeader(props: HTMLAttributes<HTMLDivElement>) {
  const { className, ...rest } = props
  return (
    <div
      data-slot="dialog-header"
      className={cn('flex flex-col gap-2 text-center sm:text-left', className)}
      {...rest}
    />
  )
}

function DialogFooter(props: HTMLAttributes<HTMLDivElement> & { showCloseButton?: boolean }) {
  const { className, children, showCloseButton = false, ...rest } = props
  return (
    <div
      data-slot="dialog-footer"
      className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)}
      {...rest}
    >
      {children}
      {showCloseButton ? (
        <DialogClose>
          <Button variant="outline">Close</Button>
        </DialogClose>
      ) : null}
    </div>
  )
}

function DialogTitle(props: HTMLAttributes<HTMLHeadingElement>) {
  const { className, ...rest } = props
  return (
    <h2
      data-slot="dialog-title"
      className={cn('text-lg leading-none font-semibold', className)}
      {...rest}
    />
  )
}

function DialogDescription(props: HTMLAttributes<HTMLParagraphElement>) {
  const { className, ...rest } = props
  return (
    <p
      data-slot="dialog-description"
      className={cn('text-sm text-muted-foreground', className)}
      {...rest}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger
}
