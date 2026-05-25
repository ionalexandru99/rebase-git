import { ChevronDownIcon, ChevronRightIcon } from 'lucide-solid'
import { Show } from 'solid-js'

export function Chevron(props: { expanded: boolean }) {
  return (
    <Show
      when={props.expanded}
      fallback={<ChevronRightIcon class="size-3 shrink-0 text-muted-foreground" />}
    >
      <ChevronDownIcon class="size-3 shrink-0 text-muted-foreground" />
    </Show>
  )
}
