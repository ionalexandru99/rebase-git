import { Show } from 'solid-js'
import { Avatar, AvatarFallback } from '../ui/avatar'
import { Button } from '../ui/button'
import { Separator } from '../ui/separator'
import { SidebarTrigger } from '../ui/sidebar'

interface TopbarProps {
  repoName: string
  repoPath: string | null
  branch: string
  onFetch?: () => void
}

export function Topbar(props: TopbarProps) {
  const initial = () => props.repoName.charAt(0).toUpperCase() || 'R'

  return (
    <div class="flex h-12 shrink-0 items-center gap-2 px-3">
      <SidebarTrigger />
      <Separator orientation="vertical" class="!h-5" />

      <div class="flex min-w-0 items-center gap-2">
        <Avatar class="size-6">
          <AvatarFallback class="text-xs">{initial()}</AvatarFallback>
        </Avatar>
        <span class="shrink-0 font-semibold">{props.repoName}</span>
        <Show when={props.repoPath}>
          <span class="min-w-0 truncate text-xs text-muted-foreground">{props.repoPath}</span>
        </Show>
      </div>

      <Separator orientation="vertical" class="!h-5" />

      <div class="flex min-w-0 items-center gap-2 rounded-md border bg-card px-2.5 py-1 text-xs">
        <span aria-hidden="true" class="size-1.5 shrink-0 rounded-full bg-primary" />
        <span class="min-w-0 truncate">{props.branch}</span>
      </div>

      <div class="flex-1" />

      <div class="flex shrink-0 items-center gap-1">
        <Button variant="ghost" size="sm" onClick={() => props.onFetch?.()}>
          Fetch
        </Button>
      </div>
    </div>
  )
}
