import * as ImagePrimitive from '@kobalte/core/image'
import { type ComponentProps, type JSX, splitProps } from 'solid-js'
import { cn } from '@/lib/utils'

function Avatar(
  props: ComponentProps<typeof ImagePrimitive.Root> & { size?: 'default' | 'sm' | 'lg' }
) {
  const [local, rest] = splitProps(props, ['class', 'size'])
  return (
    <ImagePrimitive.Root
      data-slot="avatar"
      data-size={local.size ?? 'default'}
      class={cn(
        'group/avatar relative flex size-8 shrink-0 overflow-hidden rounded-full select-none data-[size=lg]:size-10 data-[size=sm]:size-6',
        local.class
      )}
      {...rest}
    />
  )
}

function AvatarImage(props: ComponentProps<typeof ImagePrimitive.Img>) {
  const [local, rest] = splitProps(props, ['class'])
  return (
    <ImagePrimitive.Img
      data-slot="avatar-image"
      class={cn('aspect-square size-full', local.class)}
      {...rest}
    />
  )
}

function AvatarFallback(props: ComponentProps<typeof ImagePrimitive.Fallback>) {
  const [local, rest] = splitProps(props, ['class'])
  return (
    <ImagePrimitive.Fallback
      data-slot="avatar-fallback"
      class={cn(
        'flex size-full items-center justify-center rounded-full bg-muted text-sm text-muted-foreground group-data-[size=sm]/avatar:text-xs',
        local.class
      )}
      {...rest}
    />
  )
}

function AvatarBadge(props: JSX.HTMLAttributes<HTMLSpanElement>) {
  const [local, rest] = splitProps(props, ['class'])
  return (
    <span
      data-slot="avatar-badge"
      class={cn(
        'absolute right-0 bottom-0 z-10 inline-flex items-center justify-center rounded-full bg-primary text-primary-foreground ring-2 ring-background select-none',
        'group-data-[size=sm]/avatar:size-2 group-data-[size=sm]/avatar:[&>svg]:hidden',
        'group-data-[size=default]/avatar:size-2.5 group-data-[size=default]/avatar:[&>svg]:size-2',
        'group-data-[size=lg]/avatar:size-3 group-data-[size=lg]/avatar:[&>svg]:size-2',
        local.class
      )}
      {...rest}
    />
  )
}

function AvatarGroup(props: JSX.HTMLAttributes<HTMLDivElement>) {
  const [local, rest] = splitProps(props, ['class'])
  return (
    <div
      data-slot="avatar-group"
      class={cn(
        'group/avatar-group flex -space-x-2 *:data-[slot=avatar]:ring-2 *:data-[slot=avatar]:ring-background',
        local.class
      )}
      {...rest}
    />
  )
}

function AvatarGroupCount(props: JSX.HTMLAttributes<HTMLDivElement>) {
  const [local, rest] = splitProps(props, ['class'])
  return (
    <div
      data-slot="avatar-group-count"
      class={cn(
        'relative flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-sm text-muted-foreground ring-2 ring-background group-has-data-[size=lg]/avatar-group:size-10 group-has-data-[size=sm]/avatar-group:size-6 [&>svg]:size-4 group-has-data-[size=lg]/avatar-group:[&>svg]:size-5 group-has-data-[size=sm]/avatar-group:[&>svg]:size-3',
        local.class
      )}
      {...rest}
    />
  )
}

export { Avatar, AvatarBadge, AvatarFallback, AvatarGroup, AvatarGroupCount, AvatarImage }
