import { ArrowDownIcon, ArrowUpIcon } from 'lucide-react'
import { Show } from '@/lib/react-compat'

interface AheadBehindBadgeProps {
  ahead?: number
  behind?: number
}

export function AheadBehindBadge(props: AheadBehindBadgeProps) {
  const ahead = () => props.ahead ?? 0
  const behind = () => props.behind ?? 0
  return (
    <>
      <Show when={ahead() > 0}>
        <span
          data-testid="ref-ahead"
          className="flex shrink-0 items-center gap-0.5 text-xs tabular-nums text-add"
          title={`${ahead()} commit${ahead() === 1 ? '' : 's'} to push`}
        >
          <ArrowUpIcon className="size-3" />
          {ahead()}
        </span>
      </Show>
      <Show when={behind() > 0}>
        <span
          data-testid="ref-behind"
          className="flex shrink-0 items-center gap-0.5 text-xs tabular-nums text-del"
          title={`${behind()} commit${behind() === 1 ? '' : 's'} to pull`}
        >
          <ArrowDownIcon className="size-3" />
          {behind()}
        </span>
      </Show>
    </>
  )
}
