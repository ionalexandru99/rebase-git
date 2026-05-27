import type { HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

function Separator(
  props: HTMLAttributes<HTMLDivElement> & { orientation?: 'horizontal' | 'vertical' }
) {
  const { className, orientation = 'horizontal', ...rest } = props
  return (
    <div
      data-slot="separator"
      data-orientation={orientation}
      className={cn(
        'shrink-0 bg-border data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-px',
        className
      )}
      {...rest}
    />
  )
}

export { Separator }
