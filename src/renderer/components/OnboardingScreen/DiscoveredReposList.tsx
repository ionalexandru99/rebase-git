import { GitBranch } from 'lucide-react'
import { RepoListItem } from '@/components/RepoListItem'
import { ScrollArea } from '@/components/ui/scroll-area'

interface DiscoveredReposListProps {
  repos: string[]
  onOpenRepo: (path: string) => void
}

export function DiscoveredReposList({ repos, onOpenRepo }: DiscoveredReposListProps) {
  const count = repos.length
  return (
    <div className="mb-3">
      <h2 className="mb-1.5 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        Found {count} {count === 1 ? 'repository' : 'repositories'}
      </h2>
      <div className="overflow-hidden rounded-sm border border-border">
        <ScrollArea className="h-44">
          <ul className="divide-y divide-border/60">
            {repos.map((repo) => (
              <li key={repo}>
                <RepoListItem
                  path={repo}
                  icon={GitBranch}
                  variant="compact"
                  onSelect={onOpenRepo}
                />
              </li>
            ))}
          </ul>
        </ScrollArea>
      </div>
    </div>
  )
}
