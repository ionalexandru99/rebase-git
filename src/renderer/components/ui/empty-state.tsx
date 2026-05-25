import type { LucideProps } from 'lucide-solid'
import { type Component, type JSX, Show, splitProps } from 'solid-js'
import { Dynamic } from 'solid-js/web'
import { cn } from '@/lib/utils'

type EmptyStateSize = 'sm' | 'md' | 'lg'

interface EmptyStateProps extends Omit<JSX.HTMLAttributes<HTMLDivElement>, 'title'> {
  icon?: Component<LucideProps>
  title: JSX.Element
  description?: JSX.Element
  action?: JSX.Element
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

function EmptyState(props: EmptyStateProps) {
  const [local, rest] = splitProps(props, [
    'icon',
    'title',
    'description',
    'action',
    'size',
    'class'
  ])
  const sizes = () => sizeMap[local.size ?? 'md']
  return (
    <div
      data-slot="empty-state"
      class={cn('flex flex-col items-center justify-center text-center', sizes().wrap, local.class)}
      {...rest}
    >
      <Show when={local.icon}>
        {(Icon) => (
          <div
            class={cn(
              'inline-flex items-center justify-center text-muted-foreground/60',
              sizes().icon
            )}
          >
            <Dynamic component={Icon()} class="h-1/2 w-1/2" stroke-width={1.6} />
          </div>
        )}
      </Show>
      <p class={cn('text-foreground', sizes().title)}>{local.title}</p>
      <Show when={local.description}>
        <p class={cn('mt-1 max-w-xs leading-relaxed', sizes().copy)}>{local.description}</p>
      </Show>
      <Show when={local.action}>
        <div class="mt-3">{local.action}</div>
      </Show>
    </div>
  )
}

export { EmptyState }
