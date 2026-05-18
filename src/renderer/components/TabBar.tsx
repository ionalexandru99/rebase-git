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
  return (
    <div className="drag-region relative flex h-11 shrink-0 items-end bg-muted pl-1 pr-1 dark:bg-background">
      <div className="flex shrink-0 items-center gap-2 pb-2.5 pl-3 pr-4">
        <span className="text-sm font-semibold tracking-tight">Rebase</span>
      </div>

      <div role="tablist" className="no-drag flex min-w-0 items-end gap-0.5 overflow-x-auto">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId
          return (
            <TabItem
              key={tab.id}
              tab={tab}
              isActive={isActive}
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
          className="no-drag mx-1 mb-1.5 size-7 rounded-full text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
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
  onSelect: () => void
  onClose: () => void
}

function TabItem({ tab, isActive, onSelect, onClose }: TabItemProps) {
  return (
    <div
      className={cn(
        'group relative flex h-9 min-w-44 max-w-64 items-center gap-2 rounded-t-lg pl-3 pr-1.5 transition-colors',
        isActive
          ? 'z-10 bg-background text-foreground dark:bg-muted'
          : 'text-muted-foreground hover:bg-foreground/10 hover:text-foreground'
      )}
    >
      <button
        type="button"
        role="tab"
        aria-selected={isActive}
        tabIndex={isActive ? 0 : -1}
        onClick={onSelect}
        onAuxClick={(e) => {
          if (e.button === 1) {
            e.preventDefault()
            onClose()
          }
        }}
        className="flex min-w-0 flex-1 items-center gap-2 border-none bg-transparent py-0 text-left text-sm"
      >
        <GitBranch
          className={cn(
            'size-3.5 shrink-0 transition-colors',
            isActive ? 'text-foreground' : 'text-muted-foreground group-hover:text-foreground'
          )}
          strokeWidth={2}
        />
        <span className={cn('truncate', tab.hasRepo ? 'font-medium' : 'italic')}>{tab.title}</span>
      </button>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        onClick={onClose}
        aria-label={`Close tab ${tab.title}`}
        className={cn(
          'rounded-full hover:bg-foreground/15',
          !isActive && 'opacity-0 group-hover:opacity-100'
        )}
      >
        <X />
      </Button>
    </div>
  )
}
