import { type JSX, splitProps } from '@/lib/react-compat'
import { cn } from '@/lib/utils'

function Skeleton(props: JSX.HTMLAttributes<HTMLDivElement>) {
  const [local, rest] = splitProps(props, ['className'])
  return (
    <div
      data-slot="skeleton"
      className={cn('animate-pulse rounded-md bg-accent', local.className)}
      {...rest}
    />
  )
}

export { Skeleton }
