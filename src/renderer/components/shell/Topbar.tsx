import { Loader2Icon } from 'lucide-react'
import { createSignal, onCleanup, Show } from '@/lib/react-compat'
import { cn } from '@/lib/utils'

export const workspaceViewTabs = [
  { view: 'history', label: 'History' },
  { view: 'local-changes', label: 'Local changes' }
] as const

export type WorkspaceView = (typeof workspaceViewTabs)[number]['view']

interface TopbarProps {
  repoName: string
  repoPath: string | null
  activeView: WorkspaceView
  onSelectView: (view: WorkspaceView) => void
  workspaceContext?: string
  onFetch?: () => void
  onPull?: () => void
  onPush?: () => void
  pulling?: boolean
  pushing?: boolean
}

const actionButtonClass =
  'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[var(--r-sm)] bg-muted px-2.5 transition-colors hover:bg-border-strong disabled:cursor-default disabled:opacity-50'

const COPY_FEEDBACK_MS = 1100

export function Topbar(props: TopbarProps) {
  const [copied, setCopied] = createSignal(false)
  let copyTimer: ReturnType<typeof setTimeout> | null = null

  onCleanup(() => {
    if (copyTimer !== null) {
      clearTimeout(copyTimer)
    }
  })

  const copyPath = () => {
    const path = props.repoPath
    if (!path) {
      return
    }
    void navigator.clipboard?.writeText(path)
    setCopied(true)
    if (copyTimer !== null) {
      clearTimeout(copyTimer)
    }
    copyTimer = setTimeout(() => setCopied(false), COPY_FEEDBACK_MS)
  }

  return (
    <div className="grid shrink-0 grid-rows-[40px_40px] border-b p-1">
      <div className="flex min-w-0 items-center gap-2.5 px-2">
        <span className="shrink-0 font-semibold">{props.repoName}</span>
        <Show when={props.repoPath}>
          <button
            type="button"
            title="Copy path"
            onClick={copyPath}
            className={cn(
              'min-w-0 truncate rounded-[var(--r-xs)] px-1 py-0.5 text-[13px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
              copied() && 'text-green hover:text-green'
            )}
          >
            {copied() ? 'Copied path' : props.repoPath}
          </button>
        </Show>
        <div className="flex-1" />
        <button type="button" onClick={() => props.onFetch?.()} className={actionButtonClass}>
          Fetch
        </button>
        <button
          type="button"
          onClick={() => props.onPull?.()}
          disabled={props.pulling}
          className={actionButtonClass}
        >
          <Show when={props.pulling}>
            <Loader2Icon className="size-3.5 animate-spin" />
          </Show>
          Pull
        </button>
        <button
          type="button"
          onClick={() => props.onPush?.()}
          disabled={props.pushing}
          className={actionButtonClass}
        >
          <Show when={props.pushing}>
            <Loader2Icon className="size-3.5 animate-spin" />
          </Show>
          Push
        </button>
      </div>

      <div className="flex min-w-0 items-center gap-2 px-2">
        <div className="flex items-center gap-1.5">
          {workspaceViewTabs.map((tab) => (
            <button
              key={tab.view}
              type="button"
              aria-pressed={props.activeView === tab.view}
              onClick={() => props.onSelectView(tab.view)}
              className={cn(
                'h-9 rounded-[var(--r-sm)] px-3 text-muted-foreground transition-colors',
                props.activeView === tab.view
                  ? 'bg-muted text-foreground'
                  : 'hover:bg-muted/60 hover:text-foreground'
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <Show when={props.workspaceContext}>
          <span className="min-w-0 truncate text-[13px] text-muted-foreground">
            {props.workspaceContext}
          </span>
        </Show>
      </div>
    </div>
  )
}
