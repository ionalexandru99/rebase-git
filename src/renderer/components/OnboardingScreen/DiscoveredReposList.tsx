import { GitBranchIcon } from 'lucide-solid'
import { For } from 'solid-js'
import { RepoListItem } from '../RepoListItem'
import { ScrollArea } from '../ui/scroll-area'

interface DiscoveredReposListProps {
  repos: string[]
  onOpenRepo: (path: string) => void
}

export function DiscoveredReposList(props: DiscoveredReposListProps) {
  const count = () => props.repos.length
  return (
    <div class="mb-3">
      <h2 class="mb-1.5 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        Found {count()} {count() === 1 ? 'repository' : 'repositories'}
      </h2>
      <div class="overflow-hidden rounded-sm border border-border">
        <ScrollArea class="h-44">
          <ul class="divide-y divide-border/60">
            <For each={props.repos}>
              {(repo) => (
                <li>
                  <RepoListItem
                    path={repo}
                    icon={GitBranchIcon}
                    variant="compact"
                    onSelect={props.onOpenRepo}
                  />
                </li>
              )}
            </For>
          </ul>
        </ScrollArea>
      </div>
    </div>
  )
}
