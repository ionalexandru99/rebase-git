import type { ReactNode } from 'react'

interface FileSectionProps {
  label: string
  count: number
  emptyText?: string
  children?: ReactNode
}

export function FileSection(props: FileSectionProps) {
  return (
    <>
      <div className="mt-3 mb-1 flex items-center justify-between px-2 first:mt-0">
        <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          {props.label}
        </span>
        <span className="text-xs tabular-nums text-muted-foreground">{props.count}</span>
      </div>
      {props.count === 0 && props.emptyText ? (
        <p className="px-2 py-1.5 text-sm italic text-muted-foreground">{props.emptyText}</p>
      ) : (
        <ul className="space-y-px">{props.children}</ul>
      )}
    </>
  )
}
