import { ArrowDownIcon, ArrowUpIcon } from 'lucide-solid'
import { Show } from 'solid-js'

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
          class="flex shrink-0 items-center gap-0.5 text-xs tabular-nums text-emerald-500"
          title={`${ahead()} commit${ahead() === 1 ? '' : 's'} to push`}
        >
          <ArrowUpIcon class="size-3" />
          {ahead()}
        </span>
      </Show>
      <Show when={behind() > 0}>
        <span
          data-testid="ref-behind"
          class="flex shrink-0 items-center gap-0.5 text-xs tabular-nums text-rose-500"
          title={`${behind()} commit${behind() === 1 ? '' : 's'} to pull`}
        >
          <ArrowDownIcon class="size-3" />
          {behind()}
        </span>
      </Show>
    </>
  )
}
