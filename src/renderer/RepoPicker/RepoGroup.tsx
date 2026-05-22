import { RepoRow } from './RepoRow'

interface RepoGroupProps {
  label: string
  trailing?: React.ReactNode
  repos: string[]
  emptyText?: string
  onSelect: (path: string) => void
}

export function RepoGroup({ label, trailing, repos, emptyText, onSelect }: RepoGroupProps) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
          {label}
        </h3>
        {trailing && <div className="min-w-0 max-w-xs">{trailing}</div>}
      </div>
      {repos.length > 0 ? (
        <ul className="flex flex-col">
          {repos.map((repo) => (
            <li key={repo}>
              <RepoRow path={repo} onSelect={onSelect} />
            </li>
          ))}
        </ul>
      ) : emptyText ? (
        <p className="px-3 py-2 text-sm text-muted-foreground">{emptyText}</p>
      ) : null}
    </section>
  )
}
