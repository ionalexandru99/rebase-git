import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/utils'

function TooltipProvider(props: { children?: ReactNode }) {
  return <>{props.children}</>
}

function Tooltip(props: { children?: ReactNode }) {
  return <>{props.children}</>
}

function TooltipTrigger(props: HTMLAttributes<HTMLElement> & { children?: ReactNode }) {
  return <>{props.children}</>
}

function TooltipContent(props: HTMLAttributes<HTMLDivElement>) {
  const { className, ...rest } = props
  return (
    <div
      data-slot="tooltip-content"
      className={cn(
        'z-50 w-fit rounded-md bg-foreground px-3 py-1.5 text-xs text-balance text-background',
        className
      )}
      {...rest}
    />
  )
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger }
