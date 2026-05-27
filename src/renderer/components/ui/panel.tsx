import { type JSX, Show, splitProps } from '@/lib/react-compat'
import { cn } from '@/lib/utils'
import { ScrollArea } from './scroll-area'

function Panel(props: JSX.HTMLAttributes<HTMLElement>) {
  const [local, rest] = splitProps(props, ['className'])
  return (
    <section
      data-slot="panel"
      className={cn(
        'flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border bg-card',
        local.className
      )}
      {...rest}
    />
  )
}

function PanelHeader(props: JSX.HTMLAttributes<HTMLElement>) {
  const [local, rest] = splitProps(props, ['className'])
  return (
    <header
      data-slot="panel-header"
      className={cn(
        'flex h-9 shrink-0 items-center justify-between gap-2 border-b px-3',
        local.className
      )}
      {...rest}
    />
  )
}

function PanelHeaderGroup(props: JSX.HTMLAttributes<HTMLDivElement>) {
  const [local, rest] = splitProps(props, ['className'])
  return (
    <div
      data-slot="panel-header-group"
      className={cn('flex min-w-0 items-baseline gap-2', local.className)}
      {...rest}
    />
  )
}

function PanelTitle(props: JSX.HTMLAttributes<HTMLHeadingElement>) {
  const [local, rest] = splitProps(props, ['className'])
  return (
    <h2
      data-slot="panel-title"
      className={cn('text-xs font-semibold uppercase tracking-wider', local.className)}
      {...rest}
    />
  )
}

function PanelSubtitle(props: JSX.HTMLAttributes<HTMLSpanElement>) {
  const [local, rest] = splitProps(props, ['className'])
  return (
    <span
      data-slot="panel-subtitle"
      className={cn('truncate text-xs text-muted-foreground', local.className)}
      {...rest}
    />
  )
}

function PanelActions(props: JSX.HTMLAttributes<HTMLDivElement>) {
  const [local, rest] = splitProps(props, ['className'])
  return (
    <div
      data-slot="panel-actions"
      className={cn('flex shrink-0 items-center gap-2', local.className)}
      {...rest}
    />
  )
}

function PanelBody(props: JSX.HTMLAttributes<HTMLDivElement> & { scroll?: boolean }) {
  const [local, rest] = splitProps(props, ['className', 'scroll', 'children'])
  return (
    <Show
      when={local.scroll}
      fallback={
        <div data-slot="panel-body" className={cn('min-h-0 flex-1', local.className)} {...rest}>
          {local.children}
        </div>
      }
    >
      <ScrollArea
        data-slot="panel-body"
        className={cn('flex-1 min-h-0', local.className)}
        {...rest}
      >
        {local.children}
      </ScrollArea>
    </Show>
  )
}

export { Panel, PanelActions, PanelBody, PanelHeader, PanelHeaderGroup, PanelSubtitle, PanelTitle }
