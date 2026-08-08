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
        'min-w-0 rounded-xl px-3 py-[9px]',
        'transition-colors motion-reduce:transition-none data-[settings-row-highlight]:bg-card-2 data-[settings-row-highlight]:ring-1 data-[settings-row-highlight]:ring-ring',
        stacked ? 'grid gap-2.5' : 'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-6'
      )}
    >
      <div className="min-w-0">
        <span
          id={titleId}
          className="block font-medium text-[13.5px] text-foreground leading-[1.35] tracking-[-0.005em]"
        >
          {props.title}
        </span>
        {props.description ? (
          <p className="mt-px text-[12.5px] text-muted-foreground/80 leading-[1.4]">
            {props.description}
          </p>
        ) : null}
        {props.status ? (
          <div
            data-testid={`settings-row-status-${props.id}`}
            className="mt-1 text-[12px] text-muted-foreground leading-[1.4]"
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
