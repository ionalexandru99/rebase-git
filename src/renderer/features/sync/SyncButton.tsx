import type { PushForce } from '@/lib/rpc-client'
import type { PushOutcome } from '@/stores/action-runner'
import { SyncButtonView } from './SyncButtonView'
import { usePushFlow } from './usePushFlow'

interface SyncButtonProps {
  branchName: string
  ahead: number
  behind: number
  detached: boolean
  syncing: boolean
  disabled?: boolean
  onPull: () => Promise<boolean> | boolean
  onFetch: () => void
  push: (force?: PushForce, expectedRemoteSha?: string) => Promise<PushOutcome>
}

export function SyncButton(props: SyncButtonProps) {
  const pushFlow = usePushFlow({
    branchName: props.branchName,
    ahead: props.ahead,
    behind: props.behind,
    push: props.push
  })

  const sync = async () => {
    if (props.behind === 0 && props.ahead === 0) {
      props.onFetch()
      return
    }
    if (props.behind > 0 && (await props.onPull()) === false) {
      return
    }
    if (props.ahead > 0) {
      await pushFlow.requestPushAfterPull()
    }
  }

  return (
    <SyncButtonView
      ahead={props.ahead}
      behind={props.behind}
      detached={props.detached}
      syncing={props.syncing}
      disabled={props.disabled}
      onSync={() => void sync()}
      onForcePush={pushFlow.openForceConfirm}
      dialogs={pushFlow.dialogs}
    />
  )
}
