import { Loader2Icon } from 'lucide-react'
import { type JSX, splitProps } from '@/lib/react-compat'
import { cn } from '@/lib/utils'
import { Badge, type BadgeProps } from './badge'

interface LoadingBadgeProps extends BadgeProps {
  label?: JSX.Element
}

function LoadingBadge(props: LoadingBadgeProps) {
  const [local, rest] = splitProps(props, ['label', 'className'])
  return (
    <Badge
      variant="outline"
      className={cn(
        'gap-1 border-border bg-transparent font-normal text-muted-foreground',
        local.className
      )}
      {...rest}
    >
      <Loader2Icon className="animate-spin" />
      {local.label ?? 'Loading'}
    </Badge>
  )
}

export { LoadingBadge }
