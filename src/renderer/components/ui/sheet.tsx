import * as DialogPrimitive from '@kobalte/core/dialog'
import { XIcon } from 'lucide-solid'
import { type ComponentProps, type JSX, Show, splitProps } from 'solid-js'
import { cn } from '@/lib/utils'

function Sheet(props: ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="sheet" {...props} />
}

function SheetTrigger(props: ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="sheet-trigger" {...props} />
}

function SheetClose(props: ComponentProps<typeof DialogPrimitive.CloseButton>) {
  return <DialogPrimitive.CloseButton data-slot="sheet-close" {...props} />
}

function SheetOverlay(props: ComponentProps<typeof DialogPrimitive.Overlay>) {
  const [local, rest] = splitProps(props, ['class'])
  return (
    <DialogPrimitive.Overlay
      data-slot="sheet-overlay"
      class={cn(
        'fixed inset-0 z-50 bg-black/50 data-[closed]:animate-out data-[closed]:fade-out-0 data-[expanded]:animate-in data-[expanded]:fade-in-0',
        local.class
      )}
      {...rest}
    />
  )
}

const sideClasses: Record<'top' | 'right' | 'bottom' | 'left', string> = {
  right:
    'inset-y-0 right-0 h-full w-3/4 border-l data-[closed]:slide-out-to-right data-[expanded]:slide-in-from-right sm:max-w-sm',
  left: 'inset-y-0 left-0 h-full w-3/4 border-r data-[closed]:slide-out-to-left data-[expanded]:slide-in-from-left sm:max-w-sm',
  top: 'inset-x-0 top-0 h-auto border-b data-[closed]:slide-out-to-top data-[expanded]:slide-in-from-top',
  bottom:
    'inset-x-0 bottom-0 h-auto border-t data-[closed]:slide-out-to-bottom data-[expanded]:slide-in-from-bottom'
}

function SheetContent(
  props: ComponentProps<typeof DialogPrimitive.Content> & {
    side?: 'top' | 'right' | 'bottom' | 'left'
    showCloseButton?: boolean
  }
) {
  const [local, rest] = splitProps(props, ['class', 'children', 'side', 'showCloseButton'])
  return (
    <DialogPrimitive.Portal>
      <SheetOverlay />
      <DialogPrimitive.Content
        data-slot="sheet-content"
        class={cn(
          'fixed z-50 flex flex-col gap-4 bg-background shadow-lg transition ease-in-out data-[closed]:animate-out data-[closed]:duration-300 data-[expanded]:animate-in data-[expanded]:duration-500',
          sideClasses[local.side ?? 'right'],
          local.class
        )}
        {...rest}
      >
        {local.children}
        <Show when={local.showCloseButton ?? true}>
          <DialogPrimitive.CloseButton class="absolute top-4 right-4 rounded-xs opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none data-[expanded]:bg-secondary">
            <XIcon class="size-4" />
            <span class="sr-only">Close</span>
          </DialogPrimitive.CloseButton>
        </Show>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}

function SheetHeader(props: JSX.HTMLAttributes<HTMLDivElement>) {
  const [local, rest] = splitProps(props, ['class'])
  return (
    <div data-slot="sheet-header" class={cn('flex flex-col gap-1.5 p-4', local.class)} {...rest} />
  )
}

function SheetFooter(props: JSX.HTMLAttributes<HTMLDivElement>) {
  const [local, rest] = splitProps(props, ['class'])
  return (
    <div
      data-slot="sheet-footer"
      class={cn('mt-auto flex flex-col gap-2 p-4', local.class)}
      {...rest}
    />
  )
}

function SheetTitle(props: ComponentProps<typeof DialogPrimitive.Title>) {
  const [local, rest] = splitProps(props, ['class'])
  return (
    <DialogPrimitive.Title
      data-slot="sheet-title"
      class={cn('font-semibold text-foreground', local.class)}
      {...rest}
    />
  )
}

function SheetDescription(props: ComponentProps<typeof DialogPrimitive.Description>) {
  const [local, rest] = splitProps(props, ['class'])
  return (
    <DialogPrimitive.Description
      data-slot="sheet-description"
      class={cn('text-sm text-muted-foreground', local.class)}
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
