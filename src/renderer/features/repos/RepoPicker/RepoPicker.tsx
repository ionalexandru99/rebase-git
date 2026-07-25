import { FolderPlusIcon, SearchIcon, XIcon } from 'lucide-react'
import type { KeyboardEvent } from 'react'
import { useMemo, useState } from 'react'
import { fuzzyFilter } from '@/lib/fuzzy'
import { Button } from '../../../components/ui/button'
import { EmptyState } from '../../../components/ui/empty-state'
import { WorkspaceSwitcher } from '../WorkspaceSwitcher'
import {
  RepoCardGrid,
  RepoGroup,
  RepoGroupEmpty,
  RepoGroupHeader,
  RepoGroupList
} from './RepoGroup'

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
  const [query, setQuery] = useState('')
  const hasQuery = query.trim().length > 0

  const filteredDiscovered = useMemo(
    () => fuzzyFilter(query, props.discoveredRepos),
    [query, props.discoveredRepos]
  )
  const filteredRecent = useMemo(
    () => fuzzyFilter(query, props.recentRepos),
    [query, props.recentRepos]
  )
  const enterTarget = filteredRecent[0] ?? filteredDiscovered[0] ?? null

  const hasAnyWorkspace = props.workspaces.length > 0 || !!props.activeWorkspace

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') {
      return
    }
    if (enterTarget) {
      props.onOpenRepo(enterTarget)
    }
  }

  return hasAnyWorkspace ? (
    <div className="scroll-host m-1.5 min-h-0 flex-1 overflow-auto rounded-[var(--r-sm)] border bg-card shadow-[var(--shadow)]">
      <div className="mx-auto w-full max-w-3xl px-8 pb-10 pt-14">
        <div className="mb-6">
          <h2 className="mb-1 text-[22px] font-bold tracking-[-0.01em]">Open a repository</h2>
          <p className="text-sm text-muted-foreground">
            Pick a recent repository or browse your workspace.
          </p>
        </div>

        <div className="mb-7 flex h-11 items-center gap-2.5 rounded-[var(--r-md)] border bg-background px-3.5 text-muted-foreground transition-shadow focus-within:border-[var(--brand-line)] focus-within:shadow-[0_0_0_3px_var(--brand-soft)]">
          <SearchIcon className="size-4 shrink-0" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search repositories…"
            className="min-w-0 flex-1 border-0 bg-transparent text-sm text-foreground outline-none"
            aria-label="Search repositories"
            // biome-ignore lint/a11y/noAutofocus: the picker is a search-first screen; focusing the query field is the expected entry point
            autoFocus
          />
          {hasQuery ? (
            <button
              type="button"
              aria-label="Clear repository search"
              onClick={() => setQuery('')}
              className="inline-flex size-7 items-center justify-center rounded-[var(--r-sm)] transition-colors hover:bg-muted hover:text-foreground"
            >
              <XIcon className="size-4" />
            </button>
          ) : (
            <kbd className="rounded-[var(--r-xs)] border px-1.5 py-0.5 text-xs">↵</kbd>
          )}
        </div>

        <div className="flex flex-col gap-6">
          <RepoGroup>
            <RepoGroupHeader label="Recent" />
            {filteredRecent.length > 0 ? (
              <RepoCardGrid
                repos={filteredRecent}
                enterTarget={enterTarget}
                onSelect={props.onOpenRepo}
              />
            ) : (
              <RepoGroupEmpty>
                {hasQuery
                  ? 'No matches'
                  : props.recentRepos.length === 0
                    ? 'No recent repositories'
                    : undefined}
              </RepoGroupEmpty>
            )}
          </RepoGroup>

          <RepoGroup>
            <RepoGroupHeader
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
            />
            {filteredDiscovered.length > 0 ? (
              <RepoGroupList repos={filteredDiscovered} onSelect={props.onOpenRepo} />
            ) : (
              <RepoGroupEmpty>
                {hasQuery
                  ? 'No matches'
                  : props.discoveredRepos.length === 0
                    ? 'No repositories detected in this workspace'
                    : undefined}
              </RepoGroupEmpty>
            )}
          </RepoGroup>
        </div>
      </div>
    </div>
  ) : (
    <div className="flex min-h-0 flex-1 items-center justify-center bg-card p-6">
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
  )
}
