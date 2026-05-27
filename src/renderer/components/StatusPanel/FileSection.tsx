import { type JSX, Show } from '@/lib/react-compat'

interface FileSectionProps {
  label: string
  count: number
  emptyText?: string
  children?: JSX.Element
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
      <Show
        when={!(props.count === 0 && props.emptyText)}
        fallback={
          <p className="px-2 py-1.5 text-sm italic text-muted-foreground">{props.emptyText}</p>
        }
      >
        <ul className="space-y-px">{props.children}</ul>
      </Show>
    </>
  )
}
