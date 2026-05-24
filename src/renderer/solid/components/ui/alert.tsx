import { cva, type VariantProps } from 'class-variance-authority'
import { type JSX, splitProps } from 'solid-js'
import { cn } from '@/lib/utils'

const alertVariants = cva(
  'relative grid w-full grid-cols-[0_1fr] items-start gap-y-0.5 rounded-lg border px-4 py-3 text-sm has-[>svg]:grid-cols-[calc(var(--spacing)*4)_1fr] has-[>svg]:gap-x-3 [&>svg]:size-4 [&>svg]:translate-y-0.5 [&>svg]:text-current',
  {
    variants: {
      variant: {
        default: 'bg-card text-card-foreground',
        destructive:
          'bg-card text-destructive *:data-[slot=alert-description]:text-destructive/90 [&>svg]:text-current'
      }
    },
    defaultVariants: {
      variant: 'default'
    }
  }
)

function Alert(props: JSX.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>) {
  const [local, rest] = splitProps(props, ['class', 'variant'])
  return (
    <div
      data-slot="alert"
      role="alert"
      class={cn(alertVariants({ variant: local.variant }), local.class)}
      {...rest}
    />
  )
}

function AlertTitle(props: JSX.HTMLAttributes<HTMLDivElement>) {
  const [local, rest] = splitProps(props, ['class'])
  return (
    <div
      data-slot="alert-title"
      class={cn('col-start-2 line-clamp-1 min-h-4 font-medium tracking-tight', local.class)}
      {...rest}
    />
  )
}

function AlertDescription(props: JSX.HTMLAttributes<HTMLDivElement>) {
  const [local, rest] = splitProps(props, ['class'])
  return (
    <div
      data-slot="alert-description"
      class={cn(
        'col-start-2 grid justify-items-start gap-1 text-sm text-muted-foreground [&_p]:leading-relaxed',
        local.class
      )}
      {...rest}
    />
  )
}

export { Alert, AlertDescription, AlertTitle }
