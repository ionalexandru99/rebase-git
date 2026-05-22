import { Folder } from 'lucide-react'
import { Button } from '@/components/ui/button'

function repoShortName(path: string): string {
  return path.split('/').filter(Boolean).at(-1) ?? path
}

interface RepoRowProps {
  path: string
  onSelect: (path: string) => void
}

export function RepoRow({ path, onSelect }: RepoRowProps) {
  return (
    <Button
      variant="ghost"
      className="h-auto w-full justify-start gap-3 py-2 font-normal transition-none"
      onClick={() => onSelect(path)}
    >
      <Folder className="text-muted-foreground" />
      <span className="font-medium">{repoShortName(path)}</span>
      <span className="min-w-0 flex-1 truncate text-right text-xs text-muted-foreground">
        {path}
      </span>
    </Button>
  )
}
