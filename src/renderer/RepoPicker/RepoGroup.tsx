import { For, type JSX, Show } from 'solid-js'
import { RepoRow } from './RepoRow'

interface RepoGroupProps {
  label: string
  trailing?: JSX.Element
  repos: string[]
  emptyText?: string
  onSelect: (path: string) => void
}

export function RepoGroup(props: RepoGroupProps) {
  return (
    <section class="flex flex-col gap-2">
      <div class="flex items-center justify-between gap-3">
        <h3 class="text-xs font-medium tracking-wider text-muted-foreground uppercase">
          {props.label}
        </h3>
        <Show when={props.trailing}>
          <div class="min-w-0 max-w-xs">{props.trailing}</div>
        </Show>
      </div>
      <Show
        when={props.repos.length > 0}
        fallback={
          <Show when={props.emptyText}>
            <p class="px-3 py-2 text-sm text-muted-foreground">{props.emptyText}</p>
          </Show>
        }
      >
        <ul class="flex flex-col">
          <For each={props.repos}>
            {(repo) => (
              <li>
                <RepoRow path={repo} onSelect={props.onSelect} />
              </li>
            )}
          </For>
        </ul>
      </Show>
    </section>
  )
}
