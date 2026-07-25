import { GitBranchIcon } from 'lucide-react'
import { ScrollArea } from '../../components/ui/scroll-area'
import { RepoListItem } from '../repos/RepoListItem'

interface DiscoveredReposListProps {
  repos: string[]
  onOpenRepo: (path: string) => void
}

export function DiscoveredReposList(props: DiscoveredReposListProps) {
  const count = props.repos.length
  return (
    <div className="mb-3">
      <h2 className="mb-1.5 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        Found {count} {count === 1 ? 'repository' : 'repositories'}
      </h2>
      <div className="overflow-hidden rounded-sm border border-border">
        <ScrollArea className="h-44">
          <ul className="divide-y divide-border/60">
            {props.repos.map((repo) => (
              <li key={repo}>
                <RepoListItem
                  path={repo}
                  icon={GitBranchIcon}
                  variant="compact"
                  onSelect={props.onOpenRepo}
                />
              </li>
            ))}
          </ul>
        </ScrollArea>
      </div>
    </div>
  )
}
