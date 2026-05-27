import { ChevronDownIcon, ChevronRightIcon } from 'lucide-react'
import { Show } from '@/lib/react-compat'

export function Chevron(props: { expanded: boolean }) {
  return (
    <Show
      when={props.expanded}
      fallback={<ChevronRightIcon className="size-3 shrink-0 text-muted-foreground" />}
    >
      <ChevronDownIcon className="size-3 shrink-0 text-muted-foreground" />
    </Show>
  )
}
