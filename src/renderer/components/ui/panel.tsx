import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'
import { ScrollArea } from './scroll-area'

function Panel({ className, ...rest }: ComponentProps<'section'>) {
  return (
    <section
      data-slot="panel"
      className={cn(
        'flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border bg-card',
        className
      )}
      {...rest}
    />
  )
}

function PanelHeader({ className, ...rest }: ComponentProps<'header'>) {
  return (
    <header
      data-slot="panel-header"
      className={cn(
        'flex h-9 shrink-0 items-center justify-between gap-2 border-b px-3',
        className
      )}
      {...rest}
    />
  )
}

function PanelHeaderGroup({ className, ...rest }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="panel-header-group"
      className={cn('flex min-w-0 items-baseline gap-2', className)}
      {...rest}
    />
  )
}

function PanelTitle({ className, ...rest }: ComponentProps<'h2'>) {
  return (
    <h2
      data-slot="panel-title"
      className={cn('text-xs font-semibold uppercase tracking-wider', className)}
      {...rest}
    />
  )
}

function PanelSubtitle({ className, ...rest }: ComponentProps<'span'>) {
  return (
    <span
      data-slot="panel-subtitle"
      className={cn('truncate text-xs text-muted-foreground', className)}
      {...rest}
    />
  )
}

function PanelActions({ className, ...rest }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="panel-actions"
      className={cn('flex shrink-0 items-center gap-2', className)}
      {...rest}
    />
  )
}

function PanelBody({
  className,
  scroll,
  children,
  ...rest
}: ComponentProps<'div'> & { scroll?: boolean }) {
  return scroll ? (
    <ScrollArea data-slot="panel-body" className={cn('flex-1 min-h-0', className)} {...rest}>
      {children}
    </ScrollArea>
  ) : (
    <div data-slot="panel-body" className={cn('min-h-0 flex-1', className)} {...rest}>
      {children}
    </div>
  )
}

export { Panel, PanelActions, PanelBody, PanelHeader, PanelHeaderGroup, PanelSubtitle, PanelTitle }
