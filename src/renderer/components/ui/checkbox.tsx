import { CheckIcon } from 'lucide-react'
import type { ChangeEvent, MouseEvent } from 'react'
import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'

interface CheckboxProps {
  checked: boolean
  indeterminate?: boolean
  onChange: (event: ChangeEvent<HTMLInputElement>) => void
  onClick?: (event: MouseEvent<HTMLInputElement>) => void
  'aria-label': string
  className?: string
  disabled?: boolean
}

export function Checkbox(props: CheckboxProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.indeterminate = props.indeterminate ?? false
    }
  }, [props.indeterminate])

  return (
    <span
      className={cn(
        'relative inline-grid size-[15px] shrink-0 place-content-center',
        props.className
      )}
    >
      <input
        ref={inputRef}
        type="checkbox"
        checked={props.checked}
        disabled={props.disabled}
        onChange={props.onChange}
        onClick={props.onClick}
        aria-label={props['aria-label']}
        className="size-[15px] cursor-pointer appearance-none rounded-[var(--r-xs)] border-[1.5px] border-border-strong bg-card transition-colors checked:border-brand checked:bg-brand indeterminate:border-brand indeterminate:bg-brand disabled:cursor-not-allowed disabled:opacity-60"
      />
      <span className="pointer-events-none absolute inset-0 grid place-content-center">
        {props.indeterminate && <span className="h-0.5 w-2 rounded-[1px] bg-white" />}
        {!props.indeterminate && props.checked && (
          <CheckIcon className="size-2.5 text-white" strokeWidth={3.5} />
        )}
      </span>
    </span>
  )
}
