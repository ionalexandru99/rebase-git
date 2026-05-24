import { Folder, type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

function repoShortName(path: string): string {
  return path.split('/').filter(Boolean).at(-1) ?? path
}

type RepoListItemVariant = 'compact' | 'comfortable'

interface RepoListItemProps {
  path: string
  icon?: LucideIcon
  variant?: RepoListItemVariant
  onSelect: (path: string) => void
}

export function RepoListItem({
  path,
  icon: Icon = Folder,
  variant = 'comfortable',
  onSelect
}: RepoListItemProps) {
  if (variant === 'compact') {
    return (
      <button
        type="button"
        onClick={() => onSelect(path)}
        className="flex h-7 w-full items-center gap-2 border-none bg-transparent px-2.5 text-left text-sm text-foreground/85 hover:bg-accent hover:text-foreground"
      >
        <Icon className="h-3 w-3 shrink-0 text-muted-foreground" strokeWidth={2} />
        <span className="truncate">{path}</span>
      </button>
    )
  }
  return (
    <Button
      variant="ghost"
      className={cn('h-auto w-full justify-start gap-3 py-2 font-normal transition-none')}
      onClick={() => onSelect(path)}
    >
      <Icon className="text-muted-foreground" />
      <span className="font-medium">{repoShortName(path)}</span>
      <span className="min-w-0 flex-1 truncate text-right text-xs text-muted-foreground">
        {path}
      </span>
    </Button>
  )
}
