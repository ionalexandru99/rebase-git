import type * as React from 'react'

interface FileSectionProps {
  label: string
  count: number
  emptyText?: string
  children?: React.ReactNode
}

export function FileSection({ label, count, emptyText, children }: FileSectionProps) {
  return (
    <>
      <div className="mt-3 mb-1 flex items-center justify-between px-2 first:mt-0">
        <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          {label}
        </span>
        <span className="text-xs tabular-nums text-muted-foreground">{count}</span>
      </div>
      {count === 0 && emptyText ? (
        <p className="px-2 py-1.5 text-sm italic text-muted-foreground">{emptyText}</p>
      ) : (
        <ul className="space-y-px">{children}</ul>
      )}
    </>
  )
}
