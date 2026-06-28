import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

function ScrollArea({ className, children, ...rest }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="scroll-area"
      className={cn('scroll-host relative overflow-auto', className)}
      {...rest}
    >
      {children}
    </div>
  )
}

export { ScrollArea }
