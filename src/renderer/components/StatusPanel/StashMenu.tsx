import { type StashEntry, StashListResponseSchema } from '@shared/schemas/ipc'
import { SidecarOp } from '@shared/sidecar-ops'
import { Archive } from 'lucide-react'
import type { GitActions } from '@/hooks/git/useGitActions'
import { For, Show } from '@/lib/react-compat'
import { createQuery, useQueryClient } from '@/lib/react-query-compat'
import { sidecarFetch } from '@/lib/sidecar-fetch'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '../ui/dropdown-menu'

const stashKey = (repoPath: string) => ['stashes', repoPath] as const

interface StashMenuProps {
  repoPath: string | null
  actions: GitActions
  hasChanges: boolean
}

export function StashMenu(props: StashMenuProps) {
  const queryClient = useQueryClient()

  const query = createQuery<StashEntry[]>(() => {
    const path = props.repoPath
    return {
      queryKey: path ? stashKey(path) : ['stashes', 'idle'],
      enabled: Boolean(path),
      queryFn: async () => {
        if (!path) {
          return []
        }
        const response = await sidecarFetch(
          SidecarOp.stashList,
          { repoPath: path },
          StashListResponseSchema
        )
        return response._tag === 'Ok' ? response.stashes : []
      }
    }
  })

  const stashes = () => query.data ?? []

  const refetchStashes = () => {
    const path = props.repoPath
    if (path) {
      void queryClient.invalidateQueries({ queryKey: stashKey(path) })
    }
  }

  const run = (operation: Promise<boolean>) => {
    void operation.then(refetchStashes)
  }

  return (
    <div className="shrink-0">
      <DropdownMenu>
        <DropdownMenuTrigger className="flex h-7 items-center gap-1 rounded-[var(--r-sm)] border bg-card-2 px-2.5 text-xs text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground">
          <Archive className="size-3.5" />
          Stash
          <Show when={stashes().length > 0}>
            <span className="rounded-full bg-muted px-1.5 text-[10px]">{stashes().length}</span>
          </Show>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <Show
            when={props.hasChanges}
            fallback={<DropdownMenuLabel>No changes to stash</DropdownMenuLabel>}
          >
            <DropdownMenuItem onSelect={() => run(props.actions.stashPush(undefined, true))}>
              Stash all changes
            </DropdownMenuItem>
          </Show>
          <Show when={stashes().length > 0}>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Stashes</DropdownMenuLabel>
            <For each={stashes()}>
              {(stash) => (
                <>
                  <DropdownMenuItem onSelect={() => run(props.actions.stashPop(stash.index))}>
                    <span className="min-w-0 truncate">Pop: {stash.message}</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={() => run(props.actions.stashDrop(stash.index))}
                  >
                    <span className="min-w-0 truncate">Drop: {stash.message}</span>
                  </DropdownMenuItem>
                </>
              )}
            </For>
          </Show>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
