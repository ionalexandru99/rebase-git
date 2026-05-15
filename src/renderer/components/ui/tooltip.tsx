import * as React from 'react'

import { cn } from '@/lib/utils'

const TooltipProvider = ({ children }: { children: React.ReactNode }) => <>{children}</>

const Tooltip = ({ children }: { children: React.ReactNode }) => {
  const [open, setOpen] = React.useState(false)
  return <TooltipContext.Provider value={{ open, setOpen }}>{children}</TooltipContext.Provider>
}

const TooltipContext = React.createContext<{
  open: boolean
  setOpen: (open: boolean) => void
}>({ open: false, setOpen: () => {} })

const TooltipTrigger = React.forwardRef<
  React.ElementRef<'button'>,
  React.ComponentPropsWithoutRef<'button'>
>(({ children, ...props }, ref) => {
  const { setOpen } = React.useContext(TooltipContext)
  return (
    <button
      ref={ref}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      {...props}
    >
      {children}
    </button>
  )
})
TooltipTrigger.displayName = 'TooltipTrigger'

const TooltipContent = React.forwardRef<
  React.ElementRef<'div'>,
  React.ComponentPropsWithoutRef<'div'>
>(({ className, ...props }, ref) => {
  const { open } = React.useContext(TooltipContext)
  if (!open) return null
  return (
    <div
      ref={ref}
      className={cn(
        'z-50 overflow-hidden rounded-md bg-popover px-3 py-1.5 text-sm text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95',
        className
      )}
      {...props}
    />
  )
})
TooltipContent.displayName = 'TooltipContent'

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger }
