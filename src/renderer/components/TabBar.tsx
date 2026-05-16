import { GitBranch, Plus, X } from 'lucide-react'

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
    <div className="drag-region flex h-9 shrink-0 items-stretch border-b border-border bg-card/30">
      <div className="flex shrink-0 items-center gap-2 pl-3.5 pr-3">
        <RebaseMark />
        <span className="text-[12.5px] font-semibold tracking-tight text-foreground">Rebase</span>
      </div>

      <div aria-hidden className="h-full w-px shrink-0 bg-border/80" />

      <div role="tablist" className="no-drag flex min-w-0 items-stretch overflow-x-auto">
        {tabs.map((tab) => (
          <TabItem
            key={tab.id}
            tab={tab}
            isActive={tab.id === activeTabId}
            canClose={canClose}
            onSelect={() => onSelect(tab.id)}
            onClose={() => onClose(tab.id)}
          />
        ))}
        <button
          type="button"
          onClick={onNew}
          aria-label="Open new tab"
          title="New tab (⌘T)"
          className="no-drag flex h-full w-8 shrink-0 items-center justify-center text-muted-foreground transition-colors duration-[60ms] hover:bg-accent hover:text-foreground"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      </div>

      <div className="drag-region min-w-4 flex-1" />
    </div>
  )
}

interface TabItemProps {
  tab: TabDescriptor
  isActive: boolean
  canClose: boolean
  onSelect: () => void
  onClose: () => void
}

function TabItem({ tab, isActive, canClose, onSelect, onClose }: TabItemProps) {
  return (
    <div
      className={`group relative flex h-full min-w-[120px] max-w-[200px] items-center border-r border-border transition-colors duration-[60ms] ${
        isActive ? 'bg-background text-foreground' : 'text-muted-foreground hover:bg-accent'
      }`}
    >
      {isActive && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-2 top-0 h-[1.5px] bg-primary"
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
        className="flex min-w-0 flex-1 items-center gap-1.5 border-none bg-transparent px-2.5 py-0 text-left text-[11.5px] transition-colors hover:text-foreground"
      >
        <GitBranch
          className={`h-3 w-3 shrink-0 ${isActive ? 'text-primary' : 'text-muted-foreground/60'}`}
          strokeWidth={2}
        />
        <span className={`truncate ${tab.hasRepo ? 'font-medium' : 'italic'}`}>{tab.title}</span>
      </button>
      {canClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label={`Close tab ${tab.title}`}
          className={`mr-1.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-sm transition-all hover:bg-secondary hover:text-foreground ${
            isActive
              ? 'text-muted-foreground'
              : 'text-transparent group-hover:text-muted-foreground'
          }`}
        >
          <X className="h-3 w-3" strokeWidth={2.2} />
        </button>
      )}
    </div>
  )
}

function RebaseMark() {
  return (
    <div className="relative flex h-5 w-5 items-center justify-center rounded-[4px] bg-primary/12 ring-1 ring-inset ring-primary/30">
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
