import { PlusIcon, SettingsIcon, XIcon } from 'lucide-react'
import { avatarColor, avatarInitials } from '@/features/repos/repo-avatar'
import { cn } from '@/lib/utils'
import type { TabDescriptor } from '../hooks/useTabs'

export const REPO_RAIL_WIDTH = 44
const RAIL_BUTTON_SIZE = 34

interface RepoRailProps {
  tabs: TabDescriptor[]
  activeTabId: string
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onNew: () => void
  settingsOpen: boolean
  onToggleSettings: () => void
}

export function RepoRail(props: RepoRailProps) {
  const repoTabs = props.tabs.filter((tab) => tab.hasRepo)
  const activeIsBlank = !props.tabs.find((tab) => tab.id === props.activeTabId)?.hasRepo

  const openNew = () => {
    const blank = props.tabs.find((tab) => !tab.hasRepo)
    if (blank) {
      if (blank.id !== props.activeTabId) {
        props.onSelect(blank.id)
      }
      return
    }
    props.onNew()
  }

  return (
    <nav
      aria-label="Open repositories"
      style={{ width: `${REPO_RAIL_WIDTH}px` }}
      className="drag-region flex min-h-0 flex-col bg-chrome"
    >
      <div
        role="tablist"
        className="scroll-host no-drag flex min-h-0 flex-1 flex-col items-center gap-[3px] overflow-y-auto overflow-x-hidden px-1 py-2"
      >
        {repoTabs.map((tab) => (
          <RepoTabButton
            key={tab.id}
            tab={tab}
            isActive={tab.id === props.activeTabId}
            onSelect={() => props.onSelect(tab.id)}
            onClose={() => props.onClose(tab.id)}
          />
        ))}
        <button
          type="button"
          aria-label="Open new tab"
          aria-pressed={activeIsBlank}
          onClick={openNew}
          style={{ width: `${RAIL_BUTTON_SIZE}px`, height: `${RAIL_BUTTON_SIZE}px` }}
          className={cn(
            'flex shrink-0 items-center justify-center rounded-[var(--r-md)] text-[15px] text-muted-foreground transition-colors hover:bg-card-2 hover:text-foreground',
            activeIsBlank && 'bg-card-2 text-foreground'
          )}
        >
          <PlusIcon className="size-4" />
        </button>
      </div>

      <div className="no-drag flex shrink-0 items-center justify-center px-1 pb-2">
        <button
          type="button"
          aria-label="Settings"
          aria-pressed={props.settingsOpen}
          onClick={props.onToggleSettings}
          style={{ width: `${RAIL_BUTTON_SIZE}px`, height: `${RAIL_BUTTON_SIZE}px` }}
          className={cn(
            'flex shrink-0 items-center justify-center rounded-[var(--r-md)] text-muted-foreground transition-colors hover:bg-card-2 hover:text-foreground',
            props.settingsOpen && 'bg-card-2 text-foreground'
          )}
        >
          <SettingsIcon className="size-4" />
        </button>
      </div>
    </nav>
  )
}

interface RepoTabButtonProps {
  tab: TabDescriptor
  isActive: boolean
  onSelect: () => void
  onClose: () => void
}

function RepoTabButton(props: RepoTabButtonProps) {
  const colorKey = props.tab.repoPath ?? props.tab.title
  const loaded = props.tab.loaded ?? true
  const label = loaded ? props.tab.title : `${props.tab.title} - not loaded yet`
  return (
    <div className="group relative">
      <button
        type="button"
        role="tab"
        aria-selected={props.isActive}
        aria-label={label}
        title={label}
        onClick={() => props.onSelect()}
        onAuxClick={(event) => {
          if (event.button === 1) {
            event.preventDefault()
            props.onClose()
          }
        }}
        style={{ width: `${RAIL_BUTTON_SIZE}px`, height: `${RAIL_BUTTON_SIZE}px` }}
        className={cn(
          'flex shrink-0 items-center justify-center rounded-[var(--r-md)] border transition-colors',
          !loaded && !props.isActive && 'opacity-60',
          props.isActive
            ? 'border-2 border-primary p-0.5'
            : 'border-transparent p-[2px] hover:border-border hover:bg-card-2'
        )}
      >
        <span
          className={cn(
            'flex size-full items-center justify-center rounded-[7px] text-[11px] font-bold',
            loaded ? 'text-white' : 'bg-muted text-muted-foreground'
          )}
          style={loaded ? { background: avatarColor(colorKey) } : undefined}
        >
          {avatarInitials(props.tab.title)}
        </span>
      </button>
      <button
        type="button"
        aria-label={`Close tab ${props.tab.title}`}
        onClick={() => props.onClose()}
        className="no-drag absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full border border-chrome bg-muted text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
      >
        <XIcon className="size-2.5" />
      </button>
    </div>
  )
}
