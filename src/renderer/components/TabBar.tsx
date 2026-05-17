import { GitBranch, Plus, X } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface TabDescriptor {
  id: string
  title: string
  hasRepo: boolean
}

interface TabBarProps {
  tabs: TabDescriptor[]
  activeTabId: string
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onNew: () => void
}

export function TabBar({ tabs, activeTabId, onSelect, onClose, onNew }: TabBarProps) {
  const canClose = tabs.length > 1

  return (
    <div className="drag-region relative flex h-10 shrink-0 items-end bg-muted/40">
      {/* Brand sits inline with the tab strip's baseline. */}
      <div className="flex shrink-0 items-center gap-2 pb-2 pl-3 pr-4">
        <RebaseMark />
        <span className="text-sm font-semibold tracking-tight text-foreground">Rebase</span>
      </div>

      {/* Tab strip — tabs are aligned to the bottom of the bar so their rounded
          tops face up and their bottom edge meets the content area below. */}
      <div role="tablist" className="no-drag flex min-w-0 items-end overflow-x-auto">
        {tabs.map((tab, index) => {
          const isActive = tab.id === activeTabId
          const prevActive = index > 0 && tabs[index - 1].id === activeTabId
          return (
            <TabItem
              key={tab.id}
              tab={tab}
              isActive={isActive}
              showLeadingDivider={index > 0 && !isActive && !prevActive}
              canClose={canClose}
              onSelect={() => onSelect(tab.id)}
              onClose={() => onClose(tab.id)}
            />
          )
        })}

        <button
          type="button"
          onClick={onNew}
          aria-label="Open new tab"
          title="New tab (⌘T)"
          className="no-drag mx-1 mb-1 inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors duration-75 hover:bg-accent hover:text-foreground"
        >
          <Plus className="size-4" strokeWidth={2} />
        </button>
      </div>

      <div className="drag-region min-w-4 flex-1" />

      {/* Bottom hairline of the bar. The active tab sits z-10 above it so its
          background visually bridges the bar and the content area. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-border" />
    </div>
  )
}

interface TabItemProps {
  tab: TabDescriptor
  isActive: boolean
  showLeadingDivider: boolean
  canClose: boolean
  onSelect: () => void
  onClose: () => void
}

function TabItem({ tab, isActive, showLeadingDivider, canClose, onSelect, onClose }: TabItemProps) {
  return (
    <div
      className={cn(
        'group relative flex h-8.5 min-w-40 max-w-60 items-center gap-2 rounded-t-lg pl-3 pr-1.5 transition-colors duration-75',
        isActive
          ? 'z-10 bg-background text-foreground'
          : 'text-muted-foreground hover:bg-accent/40 hover:text-foreground'
      )}
    >
      {showLeadingDivider && (
        <span
          aria-hidden
          className="pointer-events-none absolute left-0 top-1/2 h-4 w-px -translate-y-1/2 bg-border/80"
        />
      )}
      <button
        type="button"
        role="tab"
        aria-selected={isActive}
        tabIndex={isActive ? 0 : -1}
        onClick={onSelect}
        onAuxClick={(e) => {
          if (e.button === 1 && canClose) {
            e.preventDefault()
            onClose()
          }
        }}
        className="flex min-w-0 flex-1 items-center gap-2 border-none bg-transparent py-0 text-left text-sm transition-colors"
      >
        <GitBranch
          className={cn(
            'size-3.5 shrink-0',
            isActive ? 'text-primary' : 'text-muted-foreground/60'
          )}
          strokeWidth={2}
        />
        <span className={cn('truncate', tab.hasRepo ? 'font-medium' : 'italic')}>{tab.title}</span>
      </button>
      {canClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label={`Close tab ${tab.title}`}
          className={cn(
            'inline-flex size-5 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-secondary hover:text-foreground',
            isActive
              ? 'text-muted-foreground'
              : 'text-transparent group-hover:text-muted-foreground'
          )}
        >
          <X className="size-3" strokeWidth={2.2} />
        </button>
      )}
    </div>
  )
}

function RebaseMark() {
  return (
    <div className="relative flex h-5 w-5 items-center justify-center rounded bg-primary/12 ring-1 ring-inset ring-primary/30">
      <svg
        viewBox="0 0 16 16"
        className="h-3 w-3 text-primary"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        role="img"
      >
        <title>Rebase logo</title>
        <circle cx="4" cy="3.5" r="1.25" />
        <circle cx="12" cy="12.5" r="1.25" />
        <path d="M4 4.75v6.5" />
        <path d="M12 3.5H8.5A3 3 0 0 0 5.5 6.5v5.5" />
      </svg>
    </div>
  )
}
