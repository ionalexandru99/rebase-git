import { type JSX, splitProps } from '@/lib/react-compat'
import { cn } from '@/lib/utils'

function ScrollArea(props: JSX.HTMLAttributes<HTMLDivElement>) {
  const [local, rest] = splitProps(props, ['className', 'children'])
  return (
    <div
      data-slot="scroll-area"
      className={cn('relative overflow-auto', local.className)}
      {...rest}
    >
      {local.children}
    </div>
  )
}

export { ScrollArea }
