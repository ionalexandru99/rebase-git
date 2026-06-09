import { For, type JSX, Show } from '@/lib/react-compat'
import { RepoCard, RepoItem } from './RepoRow'

function RepoGroup(props: { children: JSX.Element }) {
  return <section className="flex flex-col gap-2.5">{props.children}</section>
}

function RepoGroupHeader(props: { label: string; trailing?: JSX.Element }) {
  return (
    <div className="flex items-center justify-between gap-3 px-0.5">
      <h3 className="text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">
        {props.label}
      </h3>
      <Show when={props.trailing}>
        <div className="min-w-0 max-w-xs">{props.trailing}</div>
      </Show>
    </div>
  )
}

function RepoCardGrid(props: {
  repos: string[]
  enterTarget: string | null
  onSelect: (path: string) => void
}) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      <For each={props.repos}>
        {(repo) => (
          <RepoCard
            path={repo}
            isEnterTarget={repo === props.enterTarget}
            onSelect={props.onSelect}
          />
        )}
      </For>
    </div>
  )
}

function RepoGroupList(props: { repos: string[]; onSelect: (path: string) => void }) {
  return (
    <ul className="flex flex-col gap-0.5">
      <For each={props.repos}>
        {(repo) => (
          <li className="list-none">
            <RepoItem path={repo} onSelect={props.onSelect} />
          </li>
        )}
      </For>
    </ul>
  )
}

function RepoGroupEmpty(props: { children?: JSX.Element }) {
  return (
    <Show when={props.children}>
      <p className="px-3 py-2 text-sm text-muted-foreground">{props.children}</p>
    </Show>
  )
}

export { RepoCardGrid, RepoGroup, RepoGroupEmpty, RepoGroupHeader, RepoGroupList }
