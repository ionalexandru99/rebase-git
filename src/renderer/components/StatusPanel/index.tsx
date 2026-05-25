import { For, Show } from 'solid-js'
import type { GitStatus } from '@/types'
import { Badge } from '../ui/badge'
import { LoadingBadge } from '../ui/loading-badge'
import {
  Panel,
  PanelActions,
  PanelBody,
  PanelHeader,
  PanelHeaderGroup,
  PanelSubtitle,
  PanelTitle
} from '../ui/panel'
import { FileRow } from './FileRow'
import { FileSection } from './FileSection'
import { StatusPanelSkeleton } from './Skeleton'

interface StatusPanelProps {
  status: GitStatus | null
  onStage: (file: string) => void
  onUnstage: (file: string) => void
  loading: boolean
}

export function StatusPanel(props: StatusPanelProps) {
  return (
    <Show
      when={props.status}
      fallback={
        <Show when={props.loading}>
          <StatusPanelSkeleton />
        </Show>
      }
    >
      {(status) => {
        const totalChanges = () =>
          status().modified.length +
          status().staged.length +
          status().not_added.length +
          status().conflicted.length +
          status().deleted.length +
          status().created.length +
          status().renamed.length

        const subtitle = () =>
          totalChanges() === 0
            ? 'Clean working tree'
            : `${totalChanges()} pending change${totalChanges() === 1 ? '' : 's'}`

        const stagedCount = () => status().staged.length + status().created.length
        const changesCount = () =>
          status().modified.length + status().deleted.length + status().renamed.length

        return (
          <Panel>
            <PanelHeader>
              <PanelHeaderGroup>
                <PanelTitle>Working Directory</PanelTitle>
                <PanelSubtitle>{subtitle()}</PanelSubtitle>
              </PanelHeaderGroup>
              <PanelActions>
                <Show
                  when={props.loading}
                  fallback={
                    <Show
                      when={status().conflicted.length > 0}
                      fallback={
                        <Show when={totalChanges() === 0}>
                          <Badge variant="secondary">Clean</Badge>
                        </Show>
                      }
                    >
                      <Badge variant="destructive">
                        {status().conflicted.length} conflict
                        {status().conflicted.length === 1 ? '' : 's'}
                      </Badge>
                    </Show>
                  }
                >
                  <LoadingBadge />
                </Show>
              </PanelActions>
            </PanelHeader>

            <PanelBody scroll>
              <div class="px-1.5 pb-3 pt-2">
                <Show when={status().conflicted.length > 0}>
                  <FileSection label="Conflicted" count={status().conflicted.length}>
                    <For each={status().conflicted}>
                      {(file) => <FileRow file={file} kind="conflicted" />}
                    </For>
                  </FileSection>
                </Show>

                <FileSection label="Staged" count={stagedCount()} emptyText="No staged files">
                  <For each={status().staged}>
                    {(file) => (
                      <FileRow
                        file={file}
                        kind="staged"
                        actionLabel="Unstage"
                        onAction={props.onUnstage}
                      />
                    )}
                  </For>
                  <For each={status().created}>
                    {(file) => (
                      <FileRow
                        file={file}
                        kind="created"
                        actionLabel="Unstage"
                        onAction={props.onUnstage}
                      />
                    )}
                  </For>
                </FileSection>

                <FileSection
                  label="Changes"
                  count={changesCount()}
                  emptyText="No working-tree changes"
                >
                  <For each={status().modified}>
                    {(file) => (
                      <FileRow
                        file={file}
                        kind="modified"
                        actionLabel="Stage"
                        onAction={props.onStage}
                      />
                    )}
                  </For>
                  <For each={status().deleted}>
                    {(file) => (
                      <FileRow
                        file={file}
                        kind="deleted"
                        actionLabel="Stage"
                        onAction={props.onStage}
                      />
                    )}
                  </For>
                  <For each={status().renamed}>
                    {(entry) => (
                      <FileRow
                        file={entry.to}
                        display={`${entry.from} → ${entry.to}`}
                        kind="renamed"
                      />
                    )}
                  </For>
                </FileSection>

                <FileSection
                  label="Untracked"
                  count={status().not_added.length}
                  emptyText="No untracked files"
                >
                  <For each={status().not_added}>
                    {(file) => (
                      <FileRow
                        file={file}
                        kind="untracked"
                        actionLabel="Stage"
                        onAction={props.onStage}
                      />
                    )}
                  </For>
                </FileSection>
              </div>
            </PanelBody>
          </Panel>
        )
      }}
    </Show>
  )
}
