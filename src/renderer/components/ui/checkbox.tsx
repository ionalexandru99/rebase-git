import { CheckIcon } from 'lucide-react'
import type { ChangeEvent, MouseEvent } from 'react'
import { createEffect, Show } from '@/lib/react-compat'
import { cn } from '@/lib/utils'

interface CheckboxProps {
  checked: boolean
  indeterminate?: boolean
  onChange: (event: ChangeEvent<HTMLInputElement>) => void
  onClick?: (event: MouseEvent<HTMLInputElement>) => void
  'aria-label': string
  className?: string
}

export function Checkbox(props: CheckboxProps) {
  let inputEl: HTMLInputElement | undefined

  createEffect(() => {
    if (inputEl) {
      inputEl.indeterminate = props.indeterminate ?? false
    }
  })

  return (
    <span
      className={cn(
        'relative inline-grid size-[15px] shrink-0 place-content-center',
        props.className
      )}
    >
      <input
        ref={(el: HTMLInputElement | null) => {
          inputEl = el ?? undefined
        }}
        type="checkbox"
        checked={props.checked}
        onChange={props.onChange}
        onClick={props.onClick}
        aria-label={props['aria-label']}
        className="size-[15px] cursor-pointer appearance-none rounded-[var(--r-xs)] border-[1.5px] border-border-strong bg-card transition-colors checked:border-brand checked:bg-brand indeterminate:border-brand indeterminate:bg-brand"
      />
      <span className="pointer-events-none absolute inset-0 grid place-content-center">
        <Show when={props.indeterminate}>
          <span className="h-0.5 w-2 rounded-[1px] bg-white" />
        </Show>
        <Show when={!props.indeterminate && props.checked}>
          <CheckIcon className="size-2.5 text-white" strokeWidth={3.5} />
        </Show>
      </span>
    </span>
  )
}
