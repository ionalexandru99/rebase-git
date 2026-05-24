import * as TooltipPrimitive from '@kobalte/core/tooltip'
import { type ComponentProps, type JSX, splitProps } from 'solid-js'
import { cn } from '@/lib/utils'

function TooltipProvider(props: { children?: JSX.Element }) {
  return <>{props.children}</>
}

function Tooltip(props: ComponentProps<typeof TooltipPrimitive.Root>) {
  return <TooltipPrimitive.Root data-slot="tooltip" openDelay={0} closeDelay={0} {...props} />
}

function TooltipTrigger(props: ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
}

function TooltipContent(props: ComponentProps<typeof TooltipPrimitive.Content>) {
  const [local, rest] = splitProps(props, ['class', 'children'])
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        class={cn(
          'z-50 w-fit origin-(--kb-tooltip-content-transform-origin) animate-in rounded-md bg-foreground px-3 py-1.5 text-xs text-balance text-background fade-in-0 zoom-in-95 data-[closed]:animate-out data-[closed]:fade-out-0 data-[closed]:zoom-out-95',
          local.class
        )}
        {...rest}
      >
        {local.children}
        <TooltipPrimitive.Arrow class="z-50 size-2.5 bg-foreground fill-foreground" />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  )
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger }
