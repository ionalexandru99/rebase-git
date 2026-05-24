import { Loader2 } from 'lucide-react'
import type * as React from 'react'

import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

interface LoadingBadgeProps extends React.ComponentProps<typeof Badge> {
  label?: React.ReactNode
}

function LoadingBadge({ label = 'Loading', className, ...props }: LoadingBadgeProps) {
  return (
    <Badge
      variant="outline"
      className={cn(
        'gap-1 border-border bg-transparent font-normal text-muted-foreground',
        className
      )}
      {...props}
    >
      <Loader2 className="animate-spin" />
      {label}
    </Badge>
  )
}

export { LoadingBadge }
