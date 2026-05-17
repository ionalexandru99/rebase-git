import { ArrowDown, ArrowUp } from 'lucide-react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { SidebarTrigger } from '@/components/ui/sidebar'

interface TopbarProps {
  repoName: string
  repoPath: string | null
  branch: string
  ahead: number
  behind: number
  onFetch?: () => void
  onPull?: () => void
  onPush?: () => void
}

export function Topbar({
  repoName,
  repoPath,
  branch,
  ahead,
  behind,
  onFetch,
  onPull,
  onPush
}: TopbarProps) {
  const initial = repoName.charAt(0).toUpperCase() || 'R'

  return (
    <div className="flex h-12 shrink-0 items-center gap-2 px-3">
      <SidebarTrigger />
      <Separator orientation="vertical" className="!h-5" />

      <div className="flex min-w-0 items-center gap-2">
        <Avatar className="size-6">
          <AvatarFallback className="text-xs">{initial}</AvatarFallback>
        </Avatar>
        <span className="shrink-0 font-semibold">{repoName}</span>
        {repoPath && (
          <span className="min-w-0 truncate text-xs text-muted-foreground">{repoPath}</span>
        )}
      </div>

      <Separator orientation="vertical" className="!h-5" />

      <div className="flex min-w-0 items-center gap-2 rounded-md border bg-card px-2.5 py-1 text-xs">
        <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-primary" />
        <span className="min-w-0 truncate">{branch}</span>
        {ahead > 0 && (
          <span className="inline-flex shrink-0 items-center gap-0.5 text-muted-foreground">
            <ArrowUp aria-label="ahead" className="size-3" />
            {ahead}
          </span>
        )}
        {behind > 0 && (
          <span className="inline-flex shrink-0 items-center gap-0.5 text-muted-foreground">
            <ArrowDown aria-label="behind" className="size-3" />
            {behind}
          </span>
        )}
      </div>

      <div className="flex-1" />

      <div className="flex shrink-0 items-center gap-1">
        <Button variant="ghost" size="sm" onClick={onFetch}>
          Fetch
        </Button>
        <Button variant="ghost" size="sm" onClick={onPull}>
          Pull
        </Button>
        <Button
          variant={ahead > 0 ? 'default' : 'ghost'}
          size="sm"
          onClick={onPush}
          disabled={ahead === 0}
        >
          {ahead > 0 ? `Push ${ahead}` : 'Push'}
        </Button>
      </div>
    </div>
  )
}
