import * as ContextMenuPrimitive from '@kobalte/core/context-menu'
import { CheckIcon, ChevronRightIcon, CircleIcon } from 'lucide-solid'
import { type ComponentProps, type JSX, splitProps } from 'solid-js'
import { cn } from '@/lib/utils'

function ContextMenu(props: ComponentProps<typeof ContextMenuPrimitive.Root>) {
  return <ContextMenuPrimitive.Root data-slot="context-menu" {...props} />
}

function ContextMenuTrigger(props: ComponentProps<typeof ContextMenuPrimitive.Trigger>) {
  return <ContextMenuPrimitive.Trigger data-slot="context-menu-trigger" {...props} />
}

function ContextMenuGroup(props: ComponentProps<typeof ContextMenuPrimitive.Group>) {
  return <ContextMenuPrimitive.Group data-slot="context-menu-group" {...props} />
}

function ContextMenuContent(props: ComponentProps<typeof ContextMenuPrimitive.Content>) {
  const [local, rest] = splitProps(props, ['class'])
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Content
        data-slot="context-menu-content"
        class={cn(
          'z-50 min-w-[8rem] origin-(--kb-menu-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md data-[closed]:animate-out data-[closed]:fade-out-0 data-[closed]:zoom-out-95 data-[expanded]:animate-in data-[expanded]:fade-in-0 data-[expanded]:zoom-in-95',
          local.class
        )}
        {...rest}
      />
    </ContextMenuPrimitive.Portal>
  )
}

function ContextMenuItem(
  props: ComponentProps<typeof ContextMenuPrimitive.Item> & {
    inset?: boolean
    variant?: 'default' | 'destructive'
  }
) {
  const [local, rest] = splitProps(props, ['class', 'inset', 'variant'])
  return (
    <ContextMenuPrimitive.Item
      data-slot="context-menu-item"
      data-inset={local.inset}
      data-variant={local.variant ?? 'default'}
      class={cn(
        "relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[inset]:pl-8 data-[variant=destructive]:text-destructive data-[variant=destructive]:data-[highlighted]:bg-destructive/10 data-[variant=destructive]:data-[highlighted]:text-destructive dark:data-[variant=destructive]:data-[highlighted]:bg-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground data-[variant=destructive]:*:[svg]:text-destructive!",
        local.class
      )}
      {...rest}
    />
  )
}

function ContextMenuCheckboxItem(props: ComponentProps<typeof ContextMenuPrimitive.CheckboxItem>) {
  const [local, rest] = splitProps(props, ['class', 'children'])
  return (
    <ContextMenuPrimitive.CheckboxItem
      data-slot="context-menu-checkbox-item"
      class={cn(
        "relative flex cursor-default items-center gap-2 rounded-sm py-1.5 pr-2 pl-8 text-sm outline-hidden select-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        local.class
      )}
      {...rest}
    >
      <span class="pointer-events-none absolute left-2 flex size-3.5 items-center justify-center">
        <ContextMenuPrimitive.ItemIndicator>
          <CheckIcon class="size-4" />
        </ContextMenuPrimitive.ItemIndicator>
      </span>
      {local.children}
    </ContextMenuPrimitive.CheckboxItem>
  )
}

function ContextMenuRadioGroup(props: ComponentProps<typeof ContextMenuPrimitive.RadioGroup>) {
  return <ContextMenuPrimitive.RadioGroup data-slot="context-menu-radio-group" {...props} />
}

function ContextMenuRadioItem(props: ComponentProps<typeof ContextMenuPrimitive.RadioItem>) {
  const [local, rest] = splitProps(props, ['class', 'children'])
  return (
    <ContextMenuPrimitive.RadioItem
      data-slot="context-menu-radio-item"
      class={cn(
        "relative flex cursor-default items-center gap-2 rounded-sm py-1.5 pr-2 pl-8 text-sm outline-hidden select-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        local.class
      )}
      {...rest}
    >
      <span class="pointer-events-none absolute left-2 flex size-3.5 items-center justify-center">
        <ContextMenuPrimitive.ItemIndicator>
          <CircleIcon class="size-2 fill-current" />
        </ContextMenuPrimitive.ItemIndicator>
      </span>
      {local.children}
    </ContextMenuPrimitive.RadioItem>
  )
}

function ContextMenuLabel(
  props: ComponentProps<typeof ContextMenuPrimitive.GroupLabel> & { inset?: boolean }
) {
  const [local, rest] = splitProps(props, ['class', 'inset'])
  return (
    <ContextMenuPrimitive.GroupLabel
      data-slot="context-menu-label"
      data-inset={local.inset}
      class={cn('px-2 py-1.5 text-sm font-medium text-foreground data-[inset]:pl-8', local.class)}
      {...rest}
    />
  )
}

function ContextMenuSeparator(props: ComponentProps<typeof ContextMenuPrimitive.Separator>) {
  const [local, rest] = splitProps(props, ['class'])
  return (
    <ContextMenuPrimitive.Separator
      data-slot="context-menu-separator"
      class={cn('-mx-1 my-1 h-px bg-border', local.class)}
      {...rest}
    />
  )
}

function ContextMenuShortcut(props: JSX.HTMLAttributes<HTMLSpanElement>) {
  const [local, rest] = splitProps(props, ['class'])
  return (
    <span
      data-slot="context-menu-shortcut"
      class={cn('ml-auto text-xs tracking-widest text-muted-foreground', local.class)}
      {...rest}
    />
  )
}

function ContextMenuSub(props: ComponentProps<typeof ContextMenuPrimitive.Sub>) {
  return <ContextMenuPrimitive.Sub data-slot="context-menu-sub" {...props} />
}

function ContextMenuSubTrigger(
  props: ComponentProps<typeof ContextMenuPrimitive.SubTrigger> & { inset?: boolean }
) {
  const [local, rest] = splitProps(props, ['class', 'inset', 'children'])
  return (
    <ContextMenuPrimitive.SubTrigger
      data-slot="context-menu-sub-trigger"
      data-inset={local.inset}
      class={cn(
        "flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[inset]:pl-8 data-[expanded]:bg-accent data-[expanded]:text-accent-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground",
        local.class
      )}
      {...rest}
    >
      {local.children}
      <ChevronRightIcon class="ml-auto size-4" />
    </ContextMenuPrimitive.SubTrigger>
  )
}

function ContextMenuSubContent(props: ComponentProps<typeof ContextMenuPrimitive.SubContent>) {
  const [local, rest] = splitProps(props, ['class'])
  return (
    <ContextMenuPrimitive.SubContent
      data-slot="context-menu-sub-content"
      class={cn(
        'z-50 min-w-[8rem] origin-(--kb-menu-content-transform-origin) overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-lg data-[closed]:animate-out data-[closed]:fade-out-0 data-[closed]:zoom-out-95 data-[expanded]:animate-in data-[expanded]:fade-in-0 data-[expanded]:zoom-in-95',
        local.class
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
