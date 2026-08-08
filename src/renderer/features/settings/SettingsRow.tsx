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
        'min-w-0 rounded-[var(--r-md)] border bg-card px-4 py-3',
        stacked ? 'grid gap-3' : 'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4'
      )}
    >
      <div className="grid gap-1">
        <span id={titleId} className="text-sm font-medium">
          {props.title}
        </span>
        {props.description ? (
          <p className="text-xs text-muted-foreground">{props.description}</p>
        ) : null}
        {props.status ? (
          <div
            data-testid={`settings-row-status-${props.id}`}
            className="text-xs text-muted-foreground"
          >
            {props.status}
          </div>
        ) : null}
      </div>
      {props.children ? (
        <div className={cn(!stacked && 'justify-self-end')}>{props.children}</div>
      ) : null}
    </fieldset>
  )
}
