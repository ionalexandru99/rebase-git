import { cn } from '@/lib/utils'

interface SidebarBranch {
  name: string
  current: boolean
  ahead?: number
  behind?: number
}

export type SidebarView = 'history' | 'local-changes'

interface SidebarProps {
  branches: SidebarBranch[]
  workingChanges: number
  activeBranch: string
  activeView: SidebarView
  onSelectView: (view: SidebarView) => void
  onSelectBranch: (name: string) => void
  /** Width in px. If omitted, defaults to the original `w-61`. */
  width?: number
}

interface ItemProps {
  glyph?: string
  name: string
  meta?: string | number
  active?: boolean
  current?: boolean
  ahead?: number
  behind?: number
  onClick?: () => void
}

function SidebarItem({ glyph, name, meta, active, current, ahead, behind, onClick }: ItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group relative flex w-full cursor-default select-none items-center gap-2 px-3.5 py-1 text-left text-xs',
        active
          ? 'bg-white/[0.08] text-foreground'
          : 'text-[color:var(--fg-soft)] hover:bg-accent hover:text-foreground'
      )}
    >
      {active && (
        <span
          aria-hidden
          className="pointer-events-none absolute left-0 top-1 bottom-1 w-0.5 rounded-[1px] bg-primary"
        />
      )}
      {glyph !== undefined && (
        <span className="w-3 shrink-0 text-center text-xs text-[color:var(--fg-faint)]">
          {glyph}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate text-xs">{name}</span>
      {current && (
        <span className="rounded-sm border border-[color:var(--accent-line)] px-1 text-[10px] uppercase tracking-wider text-primary">
          current
        </span>
      )}
      {(ahead || behind) && (
        <span className="inline-flex shrink-0 items-center gap-1 text-xs text-[color:var(--fg-faint)]">
          {ahead ? <span className="text-[color:var(--add)]">↑{ahead}</span> : null}
          {behind ? <span className="text-[color:var(--del)]">↓{behind}</span> : null}
        </span>
      )}
      {meta !== undefined && meta !== '' && (
        <span className="shrink-0 text-xs text-[color:var(--fg-faint)]">{meta}</span>
      )}
    </button>
  )
}

function SidebarGroup({
  label,
  action,
  children
}: {
  label: string
  action?: { onClick: () => void; ariaLabel: string }
  children: React.ReactNode
}) {
  return (
    <div className="pb-1 pt-2">
      <div className="flex items-center justify-between px-3.5 py-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        <span>{label}</span>
        {action && (
          <button
            type="button"
            onClick={action.onClick}
            aria-label={action.ariaLabel}
            className="inline-flex size-4 cursor-default items-center justify-center rounded-sm text-[color:var(--fg-faint)] hover:bg-accent hover:text-[color:var(--fg-soft)]"
          >
            +
          </button>
        )}
      </div>
      {children}
    </div>
  )
}

export function Sidebar({
  branches,
  workingChanges,
  activeBranch,
  activeView,
  onSelectView,
  onSelectBranch,
  width
}: SidebarProps) {
  return (
    <div
      className="flex shrink-0 flex-col overflow-y-auto border-r border-border bg-sidebar py-2 pb-3.5"
      style={{ width: width ?? '15.25rem' }}
    >
      <SidebarGroup label="Workspace">
        <SidebarItem
          glyph="◇"
          name="Local changes"
          meta={workingChanges || ''}
          active={activeView === 'local-changes'}
          onClick={() => onSelectView('local-changes')}
        />
        <SidebarItem
          glyph="◆"
          name="History"
          active={activeView === 'history'}
          onClick={() => onSelectView('history')}
        />
      </SidebarGroup>

      <SidebarGroup
        label="Branches"
        action={{
          onClick: () => {
            /* branch creation not yet wired through useGit */
          },
          ariaLabel: 'New branch'
        }}
      >
        {branches.map((b) => (
          <SidebarItem
            key={b.name}
            glyph={b.current ? '●' : '○'}
            name={b.name}
            current={b.current}
            ahead={b.ahead}
            behind={b.behind}
            active={b.name === activeBranch}
            onClick={() => onSelectBranch(b.name)}
          />
        ))}
      </SidebarGroup>
    </div>
  )
}
