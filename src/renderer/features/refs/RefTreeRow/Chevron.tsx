import { ChevronDownIcon, ChevronRightIcon } from 'lucide-react'

export function Chevron(props: { expanded: boolean }) {
  return props.expanded ? (
    <ChevronDownIcon className="size-3 shrink-0 text-muted-foreground" />
  ) : (
    <ChevronRightIcon className="size-3 shrink-0 text-muted-foreground" />
  )
}
