import { ChevronDown, ChevronRight } from 'lucide-react'

export function Chevron({ expanded }: { expanded: boolean }) {
  return expanded ? (
    <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
  ) : (
    <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
  )
}
