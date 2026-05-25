import { type JSX, splitProps } from 'solid-js'
import { cn } from '@/lib/utils'

function ScrollArea(props: JSX.HTMLAttributes<HTMLDivElement>) {
  const [local, rest] = splitProps(props, ['class', 'children'])
  return (
    <div data-slot="scroll-area" class={cn('relative overflow-auto', local.class)} {...rest}>
      {local.children}
    </div>
  )
}

export { ScrollArea }
