import { ChevronRightIcon } from 'lucide-react'
import { avatarColor, avatarInitials } from '@/lib/repo-avatar'
import { repoDisplayName } from '@/lib/repoDisplayName'
import { cn } from '@/lib/utils'

interface RepoCardProps {
  path: string
  isEnterTarget: boolean
  onSelect: (path: string) => void
}

export function RepoCard(props: RepoCardProps) {
  return (
    <button
      type="button"
      data-testid="repo-picker-recent"
      onClick={() => props.onSelect(props.path)}
      className={cn(
        'relative grid grid-cols-[38px_minmax(0,1fr)] items-center gap-3 rounded-[var(--r-md)] border px-3 py-2.5 text-left transition-colors',
        props.isEnterTarget
          ? 'border-[var(--brand-line)] bg-[var(--brand-soft)]'
          : 'bg-card-2 hover:border-border-strong hover:bg-card'
      )}
    >
      {props.isEnterTarget && (
        <span className="absolute right-2.5 top-2 rounded-[var(--r-xs)] bg-brand/20 px-1.5 py-px text-[11px] font-semibold text-brand">
          ↵
        </span>
      )}
      <span
        className="flex size-[38px] items-center justify-center rounded-[10px] text-sm font-bold text-white"
        style={{ background: avatarColor(props.path) }}
      >
        {avatarInitials(repoDisplayName(props.path))}
      </span>
      <span className="min-w-0">
        <span className="block truncate font-semibold">{repoDisplayName(props.path)}</span>
        <span className="block truncate text-xs text-muted-foreground">{props.path}</span>
      </span>
    </button>
  )
}

interface RepoItemProps {
  path: string
  onSelect: (path: string) => void
}

export function RepoItem(props: RepoItemProps) {
  return (
    <button
      type="button"
      onClick={() => props.onSelect(props.path)}
      className="group grid h-11 w-full grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-3 rounded-[10px] px-2.5 text-left transition-colors hover:bg-muted"
    >
      <span
        className="flex size-7 items-center justify-center rounded-[10px] text-[11px] font-bold text-white"
        style={{ background: avatarColor(props.path) }}
      >
        {avatarInitials(repoDisplayName(props.path))}
      </span>
      <span className="flex min-w-0 items-baseline gap-2">
        <span className="shrink-0 truncate text-sm font-semibold">
          {repoDisplayName(props.path)}
        </span>
        <span className="min-w-0 truncate text-xs text-muted-foreground">{props.path}</span>
      </span>
      <ChevronRightIcon className="size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
    </button>
  )
}
