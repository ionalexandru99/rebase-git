import { FolderIcon, type LucideProps } from 'lucide-solid'
import { type Component, Show } from 'solid-js'
import { Dynamic } from 'solid-js/web'
import { Button } from './ui/button'

function repoShortName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
}

interface RepoListItemProps {
  path: string
  icon?: Component<LucideProps>
  variant?: 'compact' | 'comfortable'
  onSelect: (path: string) => void
}

export function RepoListItem(props: RepoListItemProps) {
  const icon = () => props.icon ?? FolderIcon
  return (
    <Show
      when={props.variant === 'compact'}
      fallback={
        <Button
          variant="ghost"
          class="h-auto w-full justify-start gap-3 py-2 font-normal transition-none"
          onClick={() => props.onSelect(props.path)}
        >
          <Dynamic component={icon()} class="text-muted-foreground" />
          <span class="font-medium">{repoShortName(props.path)}</span>
          <span class="min-w-0 flex-1 truncate text-right text-xs text-muted-foreground">
            {props.path}
          </span>
        </Button>
      }
    >
      <button
        type="button"
        onClick={() => props.onSelect(props.path)}
        class="flex h-7 w-full items-center gap-2 border-none bg-transparent px-2.5 text-left text-sm text-foreground/85 hover:bg-accent hover:text-foreground"
      >
        <Dynamic
          component={icon()}
          class="h-3 w-3 shrink-0 text-muted-foreground"
          stroke-width={2}
        />
        <span class="truncate">{props.path}</span>
      </button>
    </Show>
  )
}
