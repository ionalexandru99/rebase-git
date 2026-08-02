import { repoDisplayName } from '@/lib/repo-display-name'
import { useIdentity } from '@/stores/identity'
import { SettingsView } from './SettingsView'

interface SettingsPanelProps {
  repoPath: string | null
  onClose: () => void
}

export function SettingsPanel(props: SettingsPanelProps) {
  const identity = useIdentity(props.repoPath)

  if (!identity.identity) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">
        {identity.error ?? 'Loading settings...'}
      </div>
    )
  }

  return (
    <SettingsView
      repoLabel={props.repoPath ? repoDisplayName(props.repoPath) : null}
      identity={identity.identity}
      saving={identity.saving}
      error={identity.error}
      onSave={(scope, values) => identity.save({ scope, identity: values })}
      onClear={(fields) => identity.clear(fields)}
      onClose={props.onClose}
    />
  )
}
