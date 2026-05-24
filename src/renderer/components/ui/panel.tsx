import type * as React from 'react'

import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'

function Panel({ className, ...props }: React.ComponentProps<'section'>) {
  return (
    <section
      data-slot="panel"
      className={cn(
        'flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border bg-card',
        className
      )}
      {...props}
    />
  )
}

function PanelHeader({ className, ...props }: React.ComponentProps<'header'>) {
  return (
    <header
      data-slot="panel-header"
      className={cn(
        'flex h-9 shrink-0 items-center justify-between gap-2 border-b px-3',
        className
      )}
      {...props}
    />
  )
}

function PanelHeaderGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="panel-header-group"
      className={cn('flex min-w-0 items-baseline gap-2', className)}
      {...props}
    />
  )
}

function PanelTitle({ className, ...props }: React.ComponentProps<'h2'>) {
  return (
    <h2
      data-slot="panel-title"
      className={cn('text-xs font-semibold uppercase tracking-wider', className)}
      {...props}
    />
  )
}

function PanelSubtitle({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      data-slot="panel-subtitle"
      className={cn('truncate text-xs text-muted-foreground', className)}
      {...props}
    />
  )
}

function PanelActions({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="panel-actions"
      className={cn('flex shrink-0 items-center gap-2', className)}
      {...props}
    />
  )
}

interface PanelBodyProps extends React.ComponentProps<'div'> {
  scroll?: boolean
}

function PanelBody({ className, scroll = false, children, ...props }: PanelBodyProps) {
  if (scroll) {
    return (
      <ScrollArea
        data-slot="panel-body"
        className={cn('flex-1 min-h-0', className)}
        {...(props as React.ComponentProps<typeof ScrollArea>)}
      >
        {children}
      </ScrollArea>
    )
  }
  return (
    <div data-slot="panel-body" className={cn('min-h-0 flex-1', className)} {...props}>
      {children}
    </div>
  )
}

export { Panel, PanelActions, PanelBody, PanelHeader, PanelHeaderGroup, PanelSubtitle, PanelTitle }
