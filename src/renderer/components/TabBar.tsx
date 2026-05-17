import { GitBranch, Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
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
    <div className="drag-region relative flex h-10 shrink-0 items-end border-b bg-muted">
      <div className="flex shrink-0 items-center gap-2 pb-2 pl-3 pr-4">
        <span className="text-sm font-semibold tracking-tight">Rebase</span>
      </div>

      <div role="tablist" className="no-drag flex min-w-0 items-end overflow-x-auto">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId
          return (
            <TabItem
              key={tab.id}
              tab={tab}
              isActive={isActive}
              canClose={canClose}
              onSelect={() => onSelect(tab.id)}
              onClose={() => onClose(tab.id)}
            />
          )
        })}

        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onNew}
          aria-label="Open new tab"
          className="no-drag mx-1 mb-1"
        >
          <Plus />
        </Button>
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
      className={cn(
        'group relative flex h-8 min-w-40 max-w-60 items-center gap-2 rounded-t-md border-b-0 pl-3 pr-1',
        isActive
          ? 'z-10 border bg-background text-foreground'
          : 'text-muted-foreground hover:bg-accent hover:text-foreground'
      )}
    >
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
        className="flex min-w-0 flex-1 items-center gap-2 border-none bg-transparent py-0 text-left text-sm"
      >
        <GitBranch className="size-3.5 shrink-0" strokeWidth={2} />
        <span className={cn('truncate', tab.hasRepo ? 'font-medium' : 'italic')}>{tab.title}</span>
      </button>
      {canClose && (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={onClose}
          aria-label={`Close tab ${tab.title}`}
          className={cn(!isActive && 'opacity-0 group-hover:opacity-100')}
        >
          <X />
        </Button>
      )}
    </div>
  )
}
