import type { ReactNode } from 'react'
import { RepoCard, RepoItem } from './RepoRow'

function RepoGroup(props: { children: ReactNode }) {
  return <section className="flex flex-col gap-2.5">{props.children}</section>
}

function RepoGroupHeader(props: { label: string; trailing?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-0.5">
      <h3 className="text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">
        {props.label}
      </h3>
      {props.trailing && <div className="min-w-0 max-w-xs">{props.trailing}</div>}
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
      {props.repos.map((repo) => (
        <RepoCard
          key={repo}
          path={repo}
          isEnterTarget={repo === props.enterTarget}
          onSelect={props.onSelect}
        />
      ))}
    </div>
  )
}

function RepoGroupList(props: { repos: string[]; onSelect: (path: string) => void }) {
  return (
    <ul className="flex flex-col gap-0.5">
      {props.repos.map((repo) => (
        <li key={repo} className="list-none">
          <RepoItem path={repo} onSelect={props.onSelect} />
        </li>
      ))}
    </ul>
  )
}

function RepoGroupEmpty(props: { children?: ReactNode }) {
  return props.children ? (
    <p className="px-3 py-2 text-sm text-muted-foreground">{props.children}</p>
  ) : null
}

export { RepoCardGrid, RepoGroup, RepoGroupEmpty, RepoGroupHeader, RepoGroupList }
