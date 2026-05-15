import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { GitStatus } from '../types'

interface StatusPanelProps {
  status: GitStatus | null
  onStage: (file: string) => void
  onUnstage: (file: string) => void
  loading: boolean
}

function FileList({
  files,
  action,
  actionLabel,
  onAction,
  emptyText
}: {
  files: string[]
  action?: 'stage' | 'unstage'
  actionLabel?: string
  onAction?: (file: string) => void
  emptyText: string
}) {
  if (files.length === 0) {
    return <p className="text-sm text-muted-foreground py-1">{emptyText}</p>
  }

  return (
    <ul className="space-y-1">
      {files.map((file) => (
        <li
          key={file}
          className="flex items-center justify-between px-3 py-1.5 bg-background rounded text-sm group"
        >
          <code className="text-xs truncate mr-2">{file}</code>
          {action && onAction && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={() => onAction(file)}
            >
              {actionLabel}
            </Button>
          )}
        </li>
      ))}
    </ul>
  )
}

export function StatusPanel({ status, onStage, onUnstage, loading }: StatusPanelProps) {
  if (!status) return null

  return (
    <div className="flex flex-col bg-card rounded-lg p-4 overflow-hidden border border-border">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-base font-semibold text-card-foreground">Working Directory</h2>
        {loading && <span className="text-xs text-muted-foreground">Loading...</span>}
      </div>
      <ScrollArea className="flex-1">
        <div className="space-y-3 pr-2">
          <div>
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
              Modified{' '}
              <Badge variant="outline" className="ml-1">
                {status.modified.length}
              </Badge>
            </h3>
            <FileList
              files={status.modified}
              action="stage"
              actionLabel="Stage"
              onAction={onStage}
              emptyText="No modified files"
            />
          </div>
          <div>
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
              Staged{' '}
              <Badge variant="outline" className="ml-1">
                {status.staged.length}
              </Badge>
            </h3>
            <FileList
              files={status.staged}
              action="unstage"
              actionLabel="Unstage"
              onAction={onUnstage}
              emptyText="No staged files"
            />
          </div>
          <div>
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
              Untracked{' '}
              <Badge variant="outline" className="ml-1">
                {status.not_added.length}
              </Badge>
            </h3>
            <FileList
              files={status.not_added}
              action="stage"
              actionLabel="Stage"
              onAction={onStage}
              emptyText="No untracked files"
            />
          </div>
        </div>
      </ScrollArea>
    </div>
  )
}
