import { type JSX, Show, splitProps } from 'solid-js'
import { cn } from '@/lib/utils'
import { ScrollArea } from './scroll-area'

function Panel(props: JSX.HTMLAttributes<HTMLElement>) {
  const [local, rest] = splitProps(props, ['class'])
  return (
    <section
      data-slot="panel"
      class={cn(
        'flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border bg-card',
        local.class
      )}
      {...rest}
    />
  )
}

function PanelHeader(props: JSX.HTMLAttributes<HTMLElement>) {
  const [local, rest] = splitProps(props, ['class'])
  return (
    <header
      data-slot="panel-header"
      class={cn('flex h-9 shrink-0 items-center justify-between gap-2 border-b px-3', local.class)}
      {...rest}
    />
  )
}

function PanelHeaderGroup(props: JSX.HTMLAttributes<HTMLDivElement>) {
  const [local, rest] = splitProps(props, ['class'])
  return (
    <div
      data-slot="panel-header-group"
      class={cn('flex min-w-0 items-baseline gap-2', local.class)}
      {...rest}
    />
  )
}

function PanelTitle(props: JSX.HTMLAttributes<HTMLHeadingElement>) {
  const [local, rest] = splitProps(props, ['class'])
  return (
    <h2
      data-slot="panel-title"
      class={cn('text-xs font-semibold uppercase tracking-wider', local.class)}
      {...rest}
    />
  )
}

function PanelSubtitle(props: JSX.HTMLAttributes<HTMLSpanElement>) {
  const [local, rest] = splitProps(props, ['class'])
  return (
    <span
      data-slot="panel-subtitle"
      class={cn('truncate text-xs text-muted-foreground', local.class)}
      {...rest}
    />
  )
}

function PanelActions(props: JSX.HTMLAttributes<HTMLDivElement>) {
  const [local, rest] = splitProps(props, ['class'])
  return (
    <div
      data-slot="panel-actions"
      class={cn('flex shrink-0 items-center gap-2', local.class)}
      {...rest}
    />
  )
}

function PanelBody(props: JSX.HTMLAttributes<HTMLDivElement> & { scroll?: boolean }) {
  const [local, rest] = splitProps(props, ['class', 'scroll', 'children'])
  return (
    <Show
      when={local.scroll}
      fallback={
        <div data-slot="panel-body" class={cn('min-h-0 flex-1', local.class)} {...rest}>
          {local.children}
        </div>
      }
    >
      <ScrollArea data-slot="panel-body" class={cn('flex-1 min-h-0', local.class)} {...rest}>
        {local.children}
      </ScrollArea>
    </Show>
  )
}

export { Panel, PanelActions, PanelBody, PanelHeader, PanelHeaderGroup, PanelSubtitle, PanelTitle }
