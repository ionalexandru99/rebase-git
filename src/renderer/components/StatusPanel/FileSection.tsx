import { type JSX, Show } from 'solid-js'

interface FileSectionProps {
  label: string
  count: number
  emptyText?: string
  children?: JSX.Element
}

export function FileSection(props: FileSectionProps) {
  return (
    <>
      <div class="mt-3 mb-1 flex items-center justify-between px-2 first:mt-0">
        <span class="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          {props.label}
        </span>
        <span class="text-xs tabular-nums text-muted-foreground">{props.count}</span>
      </div>
      <Show
        when={!(props.count === 0 && props.emptyText)}
        fallback={<p class="px-2 py-1.5 text-sm italic text-muted-foreground">{props.emptyText}</p>}
      >
        <ul class="space-y-px">{props.children}</ul>
      </Show>
    </>
  )
}
