import type { ChangeEvent, MouseEvent } from 'react'
import { cn } from '@/lib/utils'

interface CheckboxProps {
  checked: boolean
  onChange: (event: ChangeEvent<HTMLInputElement>) => void
  onClick?: (event: MouseEvent<HTMLInputElement>) => void
  'aria-label': string
  className?: string
}

export function Checkbox(props: CheckboxProps) {
  return (
    <input
      type="checkbox"
      checked={props.checked}
      onChange={props.onChange}
      onClick={props.onClick}
      aria-label={props['aria-label']}
      className={cn(
        'size-[15px] shrink-0 cursor-pointer appearance-none rounded-[var(--r-xs)] border-[1.5px] border-border-strong bg-card transition-colors',
        'checked:border-brand checked:bg-brand',
        "checked:after:mx-auto checked:after:-mt-px checked:after:block checked:after:h-2 checked:after:w-1 checked:after:rotate-45 checked:after:border-white checked:after:border-b-2 checked:after:border-r-2 checked:after:content-['']",
        props.className
      )}
    />
  )
}
