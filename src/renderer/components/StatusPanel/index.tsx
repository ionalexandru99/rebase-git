import { Badge } from '@/components/ui/badge'
import { LoadingBadge } from '@/components/ui/loading-badge'
import {
  Panel,
  PanelActions,
  PanelBody,
  PanelHeader,
  PanelHeaderGroup,
  PanelSubtitle,
  PanelTitle
} from '@/components/ui/panel'
import type { GitStatus } from '@/types'
import { FileRow } from './FileRow'
import { FileSection } from './FileSection'
import { StatusPanelSkeleton } from './Skeleton'

interface StatusPanelProps {
  status: GitStatus | null
  onStage: (file: string) => void
  onUnstage: (file: string) => void
  loading: boolean
}

export function StatusPanel({ status, onStage, onUnstage, loading }: StatusPanelProps) {
  if (!status) {
    if (loading) return <StatusPanelSkeleton />
    return null
  }

  const totalChanges =
    status.modified.length +
    status.staged.length +
    status.not_added.length +
    status.conflicted.length +
    status.deleted.length +
    status.created.length +
    status.renamed.length

  const subtitle =
    totalChanges === 0
      ? 'Clean working tree'
      : `${totalChanges} pending change${totalChanges === 1 ? '' : 's'}`

  const stagedCount = status.staged.length + status.created.length
  const changesCount = status.modified.length + status.deleted.length + status.renamed.length

  return (
    <Panel>
      <PanelHeader>
        <PanelHeaderGroup>
          <PanelTitle>Working Directory</PanelTitle>
          <PanelSubtitle>{subtitle}</PanelSubtitle>
        </PanelHeaderGroup>
        <PanelActions>
          {loading ? (
            <LoadingBadge />
          ) : status.conflicted.length > 0 ? (
            <Badge variant="destructive">
              {status.conflicted.length} conflict{status.conflicted.length === 1 ? '' : 's'}
            </Badge>
          ) : totalChanges === 0 ? (
            <Badge variant="secondary">Clean</Badge>
          ) : null}
        </PanelActions>
      </PanelHeader>

      <PanelBody scroll>
        <div className="px-1.5 pb-3 pt-2">
          {status.conflicted.length > 0 && (
            <FileSection label="Conflicted" count={status.conflicted.length}>
              {status.conflicted.map((file) => (
                <FileRow key={file} file={file} kind="conflicted" />
              ))}
            </FileSection>
          )}

          <FileSection label="Staged" count={stagedCount} emptyText="No staged files">
            {status.staged.map((file) => (
              <FileRow
                key={`s:${file}`}
                file={file}
                kind="staged"
                actionLabel="Unstage"
                onAction={onUnstage}
              />
            ))}
            {status.created.map((file) => (
              <FileRow
                key={`c:${file}`}
                file={file}
                kind="created"
                actionLabel="Unstage"
                onAction={onUnstage}
              />
            ))}
          </FileSection>

          <FileSection label="Changes" count={changesCount} emptyText="No working-tree changes">
            {status.modified.map((file) => (
              <FileRow
                key={`m:${file}`}
                file={file}
                kind="modified"
                actionLabel="Stage"
                onAction={onStage}
              />
            ))}
            {status.deleted.map((file) => (
              <FileRow
                key={`d:${file}`}
                file={file}
                kind="deleted"
                actionLabel="Stage"
                onAction={onStage}
              />
            ))}
            {status.renamed.map((entry) => (
              <FileRow
                key={`r:${entry.from}->${entry.to}`}
                file={entry.to}
                display={`${entry.from} → ${entry.to}`}
                kind="renamed"
              />
            ))}
          </FileSection>

          <FileSection
            label="Untracked"
            count={status.not_added.length}
            emptyText="No untracked files"
          >
            {status.not_added.map((file) => (
              <FileRow
                key={`u:${file}`}
                file={file}
                kind="untracked"
                actionLabel="Stage"
                onAction={onStage}
              />
            ))}
          </FileSection>
        </div>
      </PanelBody>
    </Panel>
  )
}
