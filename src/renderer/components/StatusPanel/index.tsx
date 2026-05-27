import { Show } from '@/lib/react-compat'
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
import { StatusPanelSkeleton } from './Skeleton'
import { VirtualFileList } from './VirtualFileList'

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

            <PanelBody className="flex min-h-0 flex-col">
              <VirtualFileList
                status={status()}
                onStage={props.onStage}
                onUnstage={props.onUnstage}
              />
            </PanelBody>
          </Panel>
        )
      }}
    </Show>
  )
}
