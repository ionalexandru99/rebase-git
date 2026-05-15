import * as React from 'react'

import { cn } from '@/lib/utils'

const ScrollArea = React.forwardRef<
  React.ElementRef<'div'>,
  React.ComponentPropsWithoutRef<'div'> & { viewportClassName?: string }
>(({ className, viewportClassName, children, ...props }, ref) => (
  <div ref={ref} className={cn('relative overflow-hidden', className)} {...props}>
    <div className={cn('h-full w-full overflow-auto rounded-[inherit]', viewportClassName)}>
      {children}
    </div>
  </div>
))
ScrollArea.displayName = 'ScrollArea'

export { ScrollArea }
