import { FolderPlus, GitBranch, Search } from 'lucide-react'
import { type KeyboardEvent as ReactKeyboardEvent, useState } from 'react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { WorkspaceSwitcher } from '@/components/WorkspaceSwitcher'
import { fuzzyFilter } from '@/lib/fuzzy'
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

export function RepoPicker({
  recentRepos,
  discoveredRepos,
  workspaces,
  activeWorkspace,
  onSwitchWorkspace,
  onAddWorkspace,
  onRemoveWorkspace,
  onOpenRepo
}: RepoPickerProps) {
  const [query, setQuery] = useState('')
  const hasQuery = query.trim().length > 0

  const filteredDiscovered = fuzzyFilter(query, discoveredRepos)
  const filteredRecent = fuzzyFilter(query, recentRepos)

  const hasAnyWorkspace = workspaces.length > 0 || !!activeWorkspace

  if (!hasAnyWorkspace) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-6">
        <EmptyState
          size="lg"
          icon={FolderPlus}
          title="Add a workspace"
          description="Repositories open from a workspace folder. Pick a folder that contains your Git repositories to get started."
          action={
            <Button onClick={() => onAddWorkspace()}>
              <FolderPlus />
              Add workspace…
            </Button>
          }
        />
      </div>
    )
  }

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return
    const first = filteredRecent[0] ?? filteredDiscovered[0]
    if (first) onOpenRepo(first)
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-10">
        <div className="flex items-center gap-3">
          <div className="rounded-md border bg-card p-2">
            <GitBranch className="size-4 text-muted-foreground" />
          </div>
          <div>
            <h2 className="text-base font-semibold">Open a repository</h2>
            <p className="text-sm text-muted-foreground">
              Pick a repository from your workspace or recents.
            </p>
          </div>
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search repositories…"
            className="pl-9"
            aria-label="Search repositories"
            autoFocus
          />
        </div>

        <RepoGroup
          label="Recent"
          repos={filteredRecent}
          emptyText={
            hasQuery
              ? 'No matches'
              : recentRepos.length === 0
                ? 'No recent repositories'
                : undefined
          }
          onSelect={onOpenRepo}
        />

        <RepoGroup
          label="Workspace"
          trailing={
            <WorkspaceSwitcher
              workspaces={workspaces}
              activeWorkspace={activeWorkspace}
              onSwitch={onSwitchWorkspace}
              onAdd={onAddWorkspace}
              onRemove={onRemoveWorkspace}
            />
          }
          repos={filteredDiscovered}
          emptyText={
            hasQuery
              ? 'No matches'
              : discoveredRepos.length === 0
                ? 'No repositories detected in this workspace'
                : undefined
          }
          onSelect={onOpenRepo}
        />
      </div>
    </div>
  )
}
