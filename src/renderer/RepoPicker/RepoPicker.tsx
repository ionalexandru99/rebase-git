import { FolderPlusIcon, GitBranchIcon, SearchIcon } from 'lucide-solid'
import { createMemo, createSignal, type JSX, Show } from 'solid-js'
import { fuzzyFilter } from '@/lib/fuzzy'
import { Button } from '../components/ui/button'
import { EmptyState } from '../components/ui/empty-state'
import { Input } from '../components/ui/input'
import { WorkspaceSwitcher } from '../components/WorkspaceSwitcher'
import { RepoGroup } from './RepoGroup'

interface RepoPickerProps {
  recentRepos: string[]
  discoveredRepos: string[]
  workspaces: string[]
  activeWorkspace: string | null
  onSwitchWorkspace: (path: string) => Promise<void>
  onAddWorkspace: () => Promise<unknown>
  onRemoveWorkspace: (path: string) => Promise<void>
  onOpenRepo: (path: string) => void
}

export function RepoPicker(props: RepoPickerProps) {
  const [query, setQuery] = createSignal('')
  const hasQuery = () => query().trim().length > 0

  const filteredDiscovered = createMemo(() => fuzzyFilter(query(), props.discoveredRepos))
  const filteredRecent = createMemo(() => fuzzyFilter(query(), props.recentRepos))

  const hasAnyWorkspace = () => props.workspaces.length > 0 || !!props.activeWorkspace

  const handleKeyDown: JSX.EventHandler<HTMLInputElement, KeyboardEvent> = (event) => {
    if (event.key !== 'Enter') return
    const first = filteredRecent()[0] ?? filteredDiscovered()[0]
    if (first) props.onOpenRepo(first)
  }

  return (
    <Show
      when={hasAnyWorkspace()}
      fallback={
        <div class="flex min-h-0 flex-1 items-center justify-center p-6">
          <EmptyState
            size="lg"
            icon={FolderPlusIcon}
            title="Add a workspace"
            description="Repositories open from a workspace folder. Pick a folder that contains your Git repositories to get started."
            action={
              <Button onClick={() => props.onAddWorkspace()}>
                <FolderPlusIcon />
                Add workspace…
              </Button>
            }
          />
        </div>
      }
    >
      <div class="min-h-0 flex-1 overflow-auto">
        <div class="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-10">
          <div class="flex items-center gap-3">
            <div class="rounded-md border bg-card p-2">
              <GitBranchIcon class="size-4 text-muted-foreground" />
            </div>
            <div>
              <h2 class="text-base font-semibold">Open a repository</h2>
              <p class="text-sm text-muted-foreground">
                Pick a repository from your workspace or recents.
              </p>
            </div>
          </div>

          <div class="relative">
            <SearchIcon class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              value={query()}
              onInput={(event) => setQuery(event.currentTarget.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search repositories…"
              class="pl-9"
              aria-label="Search repositories"
              autofocus
            />
          </div>

          <RepoGroup
            label="Recent"
            repos={filteredRecent()}
            emptyText={
              hasQuery()
                ? 'No matches'
                : props.recentRepos.length === 0
                  ? 'No recent repositories'
                  : undefined
            }
            onSelect={props.onOpenRepo}
          />

          <RepoGroup
            label="Workspace"
            trailing={
              <WorkspaceSwitcher
                workspaces={props.workspaces}
                activeWorkspace={props.activeWorkspace}
                onSwitch={props.onSwitchWorkspace}
                onAdd={props.onAddWorkspace}
                onRemove={props.onRemoveWorkspace}
              />
            }
            repos={filteredDiscovered()}
            emptyText={
              hasQuery()
                ? 'No matches'
                : props.discoveredRepos.length === 0
                  ? 'No repositories detected in this workspace'
                  : undefined
            }
            onSelect={props.onOpenRepo}
          />
        </div>
      </div>
    </Show>
  )
}
