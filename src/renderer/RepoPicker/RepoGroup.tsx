import { For, type JSX, Show } from '@/lib/react-compat'
import { RepoRow } from './RepoRow'

function RepoGroup(props: { children: JSX.Element }) {
  return <section className="flex flex-col gap-2">{props.children}</section>
}

function RepoGroupHeader(props: { label: string; trailing?: JSX.Element }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h3 className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
        {props.label}
      </h3>
      <Show when={props.trailing}>
        <div className="min-w-0 max-w-xs">{props.trailing}</div>
      </Show>
    </div>
  )
}

function RepoGroupList(props: { repos: string[]; onSelect: (path: string) => void }) {
  return (
    <ul className="flex flex-col">
      <For each={props.repos}>
        {(repo) => (
          <li>
            <RepoRow path={repo} onSelect={props.onSelect} />
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

export { RepoGroup, RepoGroupEmpty, RepoGroupHeader, RepoGroupList }
