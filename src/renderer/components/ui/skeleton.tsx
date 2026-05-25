import { type JSX, splitProps } from 'solid-js'
import { cn } from '@/lib/utils'

function Skeleton(props: JSX.HTMLAttributes<HTMLDivElement>) {
  const [local, rest] = splitProps(props, ['class'])
  return (
    <div
      data-slot="skeleton"
      class={cn('animate-pulse rounded-md bg-accent', local.class)}
      {...rest}
    />
  )
}

export { Skeleton }
