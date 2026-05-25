import { Loader2Icon } from 'lucide-solid'
import { type JSX, splitProps } from 'solid-js'
import { cn } from '@/lib/utils'
import { Badge, type BadgeProps } from './badge'

interface LoadingBadgeProps extends BadgeProps {
  label?: JSX.Element
}

function LoadingBadge(props: LoadingBadgeProps) {
  const [local, rest] = splitProps(props, ['label', 'class'])
  return (
    <Badge
      variant="outline"
      class={cn(
        'gap-1 border-border bg-transparent font-normal text-muted-foreground',
        local.class
      )}
      {...rest}
    >
      <Loader2Icon class="animate-spin" />
      {local.label ?? 'Loading'}
    </Badge>
  )
}

export { LoadingBadge }
