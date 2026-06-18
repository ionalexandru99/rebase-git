import type { LucideProps } from 'lucide-react'
import type { ComponentProps, ComponentType, ReactNode } from 'react'
import { cn } from '@/lib/utils'

type EmptyStateSize = 'sm' | 'md' | 'lg'

interface EmptyStateProps extends Omit<ComponentProps<'div'>, 'title'> {
  icon?: ComponentType<LucideProps>
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  size?: EmptyStateSize
}

const sizeMap: Record<EmptyStateSize, { wrap: string; icon: string; title: string; copy: string }> =
  {
    sm: {
      wrap: 'gap-1 px-4 py-6',
      icon: 'mb-2 size-7 rounded-md border border-dashed',
      title: 'text-sm font-medium',
      copy: 'text-xs text-muted-foreground'
    },
    md: {
      wrap: 'gap-1 px-4 py-10',
      icon: 'mb-3 size-9 rounded-md border border-dashed',
      title: 'text-base font-semibold',
      copy: 'text-sm text-muted-foreground'
    },
    lg: {
      wrap: 'gap-3 px-6 py-14',
      icon: 'mb-2 size-10 rounded-full border',
      title: 'text-base font-semibold',
      copy: 'text-sm text-muted-foreground'
    }
  }

function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  size,
  className,
  ...rest
}: EmptyStateProps) {
  const sizes = sizeMap[size ?? 'md']
  return (
    <div
      data-slot="empty-state"
      className={cn('flex flex-col items-center justify-center text-center', sizes.wrap, className)}
      {...rest}
    >
      {Icon && (
        <div
          className={cn(
            'inline-flex items-center justify-center text-muted-foreground/60',
            sizes.icon
          )}
        >
          <Icon className="h-1/2 w-1/2" strokeWidth={1.6} />
        </div>
      )}
      <p className={cn('text-foreground', sizes.title)}>{title}</p>
      {description && (
        <p className={cn('mt-1 max-w-xs leading-relaxed', sizes.copy)}>{description}</p>
      )}
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}

export { EmptyState }
