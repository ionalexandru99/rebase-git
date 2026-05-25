import { GitBranchIcon, PlusIcon, XIcon } from 'lucide-solid'
import { For } from 'solid-js'
import { cn } from '@/lib/utils'
import type { TabDescriptor } from '../hooks/useTabs'
import { Button } from './ui/button'

interface TabBarProps {
  tabs: TabDescriptor[]
  activeTabId: string
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onNew: () => void
}

export function TabBar(props: TabBarProps) {
  return (
    <div class="drag-region relative flex h-11 shrink-0 items-end bg-muted pl-1 pr-1 dark:bg-background">
      <BrandTitle />

      <div role="tablist" class="no-drag flex min-w-0 items-end gap-0.5 overflow-x-auto">
        <For each={props.tabs}>
          {(tab) => (
            <TabItem
              tab={tab}
              isActive={tab.id === props.activeTabId}
              onSelect={() => props.onSelect(tab.id)}
              onClose={() => props.onClose(tab.id)}
            />
          )}
        </For>
        <NewTabButton onClick={() => props.onNew()} />
      </div>

      <div class="drag-region min-w-4 flex-1" />
    </div>
  )
}

function BrandTitle() {
  return (
    <div class="flex shrink-0 items-center gap-2 pb-2.5 pl-3 pr-4">
      <span class="text-sm font-semibold tracking-tight">Rebase</span>
    </div>
  )
}

function NewTabButton(props: { onClick: () => void }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      onClick={() => props.onClick()}
      aria-label="Open new tab"
      class="no-drag mx-1 mb-1.5 size-7 rounded-full text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
    >
      <PlusIcon />
    </Button>
  )
}

interface TabItemProps {
  tab: TabDescriptor
  isActive: boolean
  onSelect: () => void
  onClose: () => void
}

function TabItem(props: TabItemProps) {
  return (
    <div
      class={cn(
        'group relative flex h-9 min-w-44 max-w-64 items-center gap-2 rounded-t-lg pl-3 pr-1.5 transition-colors',
        props.isActive
          ? 'z-10 bg-background text-foreground dark:bg-muted'
          : 'text-muted-foreground hover:bg-foreground/10 hover:text-foreground'
      )}
    >
      <button
        type="button"
        role="tab"
        aria-selected={props.isActive}
        tabindex={props.isActive ? 0 : -1}
        onClick={() => props.onSelect()}
        onAuxClick={(event) => {
          if (event.button === 1) {
            event.preventDefault()
            props.onClose()
          }
        }}
        class="flex min-w-0 flex-1 items-center gap-2 border-none bg-transparent py-0 text-left text-sm"
      >
        <GitBranchIcon
          class={cn(
            'size-3.5 shrink-0 transition-colors',
            props.isActive ? 'text-foreground' : 'text-muted-foreground group-hover:text-foreground'
          )}
          stroke-width={2}
        />
        <span class={cn('truncate', props.tab.hasRepo ? 'font-medium' : 'italic')}>
          {props.tab.title}
        </span>
      </button>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        onClick={() => props.onClose()}
        aria-label={`Close tab ${props.tab.title}`}
        class={cn(
          'rounded-full hover:bg-foreground/15',
          !props.isActive && 'opacity-0 group-hover:opacity-100'
        )}
      >
        <XIcon />
      </Button>
    </div>
  )
}
