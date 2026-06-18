import { Loader2Icon } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Badge, type BadgeProps } from './badge'

interface LoadingBadgeProps extends BadgeProps {
  label?: ReactNode
}

function LoadingBadge({ label, className, ...rest }: LoadingBadgeProps) {
  return (
    <Badge
      variant="outline"
      className={cn(
        'gap-1 border-border bg-transparent font-normal text-muted-foreground',
        className
      )}
      {...rest}
    >
      <Loader2Icon className="animate-spin" />
      {label ?? 'Loading'}
    </Badge>
  )
}

export { LoadingBadge }
