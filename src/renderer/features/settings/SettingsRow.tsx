import type { ReactNode } from 'react'
import { useId } from 'react'
import { cn } from '@/lib/utils'

export interface SettingsRowProps {
  id: string
  title: string
  description?: string
  status?: ReactNode
  variant?: 'inline' | 'stacked'
  children?: ReactNode
}

export function SettingsRow(props: SettingsRowProps) {
  const titleId = useId()
  const stacked = props.variant === 'stacked'

  return (
    <fieldset
      id={props.id}
      data-settings-row={props.id}
      aria-labelledby={titleId}
      className={cn(
        'min-w-0 rounded-xl px-4 py-3',
        'transition-colors motion-reduce:transition-none data-[settings-row-highlight]:bg-card-2 data-[settings-row-highlight]:ring-1 data-[settings-row-highlight]:ring-ring',
        stacked
          ? 'grid gap-4'
          : 'grid grid-cols-[minmax(0,1fr)_minmax(10rem,auto)] items-center gap-8'
      )}
    >
      <div className="min-w-0 space-y-1">
        <span
          id={titleId}
          className="block font-medium text-foreground text-sm tracking-[-0.005em]"
        >
          {props.title}
        </span>
        {props.description ? (
          <p className="max-w-xl text-[13px] text-muted-foreground/80 leading-[1.45]">
            {props.description}
          </p>
        ) : null}
        {props.status ? (
          <div
            data-testid={`settings-row-status-${props.id}`}
            className="pt-0.5 text-muted-foreground text-xs"
          >
            {props.status}
          </div>
        ) : null}
      </div>
      {props.children ? (
        <div className={cn(!stacked && 'flex items-center justify-self-end')}>{props.children}</div>
      ) : null}
    </fieldset>
  )
}
