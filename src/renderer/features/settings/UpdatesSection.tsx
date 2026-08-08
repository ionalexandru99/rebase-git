import type {
  UpdateChannel,
  UpdatePreferences,
  UpdaterActionResult,
  UpdaterState
} from '@shared/schemas/ipc'
import { DownloadIcon, TriangleAlertIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { hasPendingUpdate, useUpdaterState } from '@/hooks/useUpdaterState'
import { SettingsRow } from './SettingsRow'
import { SettingsSection } from './SettingsSection'
import type { SettingsSectionEntry } from './sections'

interface UpdaterActionButton {
  label: string
  disabled: boolean
  invoke: (() => Promise<UpdaterActionResult>) | null
}

function describeAction(state: UpdaterState): UpdaterActionButton {
  if (state.status === 'checking') {
    return { label: 'Checking…', disabled: true, invoke: null }
  }
  if (state.status === 'available') {
    return { label: 'Download', disabled: false, invoke: () => window.electronAPI.downloadUpdate() }
  }
  if (state.status === 'downloading') {
    const percent = state.downloadPercent === null ? '' : ` ${Math.round(state.downloadPercent)}%`
    return { label: `Downloading…${percent}`, disabled: true, invoke: null }
  }
  if (state.status === 'downloaded') {
    return {
      label: 'Install and restart',
      disabled: false,
      invoke: () => window.electronAPI.installUpdate()
    }
  }
  return {
    label: 'Check for updates',
    disabled: false,
    invoke: () => window.electronAPI.checkForUpdates()
  }
}

function availabilityLine(state: UpdaterState): string | null {
  if (state.status === 'up-to-date') {
    return "You're on the latest version."
  }
  if (state.status === 'available') {
    return `Version ${state.availableVersion} is ready to download.`
  }
  if (state.status === 'downloading') {
    return `Version ${state.availableVersion} is downloading.`
  }
  if (state.status === 'downloaded') {
    return `Version ${state.availableVersion} is ready to install.`
  }
  return null
}

function VersionStatus(props: { updater: UpdaterState; rejection: string | null }) {
  if (!props.updater.supported) {
    return <p>{props.updater.unsupportedReason}</p>
  }

  const line = availabilityLine(props.updater)

  return (
    <div className="grid gap-0.5">
      {line ? <p>{line}</p> : null}
      {props.updater.errorMessage ? (
        <p className="text-destructive">{props.updater.errorMessage}</p>
      ) : null}
      {props.rejection ? <p className="text-destructive">{props.rejection}</p> : null}
      {props.updater.lastCheckedAt ? (
        <p>Last checked {new Date(props.updater.lastCheckedAt).toLocaleString()}</p>
      ) : null}
    </div>
  )
}

function VersionRow(props: { updater: UpdaterState | null }) {
  const [rejection, setRejection] = useState<string | null>(null)

  const action =
    props.updater === null || !props.updater.supported ? null : describeAction(props.updater)

  const runAction = (invoke: () => Promise<UpdaterActionResult>): void => {
    setRejection(null)
    invoke()
      .then((result) => {
        if (result._tag === 'Rejected') {
          setRejection(result.reason)
        }
      })
      .catch((error: unknown) => {
        console.error('[settings] update action failed', error)
      })
  }

  return (
    <SettingsRow
      id="settings-updates-version"
      title="Version"
      description={props.updater === null ? undefined : `Rebase ${props.updater.currentVersion}`}
      status={
        props.updater === null ? null : (
          <VersionStatus updater={props.updater} rejection={rejection} />
        )
      }
    >
      {action === null ? null : (
        <Button
          type="button"
          size="sm"
          className="h-[30px] px-2.5 text-[12.5px]"
          disabled={action.disabled}
          onClick={() => {
            if (action.invoke) {
              runAction(action.invoke)
            }
          }}
        >
          {action.label}
        </Button>
      )}
    </SettingsRow>
  )
}

const CHANNEL_OPTIONS: Array<{ value: UpdateChannel; label: string }> = [
  { value: 'stable', label: 'Stable' },
  { value: 'nightly', label: 'Nightly' }
]

function actionInProgress(updater: UpdaterState | null): boolean {
  return updater !== null && (updater.status === 'checking' || updater.status === 'downloading')
}

function NightlyWarning() {
  return (
    <Alert className="mx-3 mt-1.5 p-3">
      <TriangleAlertIcon />
      <AlertTitle className="text-[12.5px]">Nightly builds ship straight from main</AlertTitle>
      <AlertDescription className="text-[12px] leading-[1.45]">
        <p>
          They are not release tested and can break at any time. Switching back to Stable downgrades
          to the latest stable release at the next check.
        </p>
      </AlertDescription>
    </Alert>
  )
}

function UpdateChannelRow(props: { updater: UpdaterState | null }) {
  const [channel, setChannel] = useState<UpdateChannel | null>(null)
  const [rejection, setRejection] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    window.electronAPI
      .getUpdateChannel()
      .then((stored) => {
        if (!cancelled) {
          setChannel(stored)
        }
      })
      .catch((error: unknown) => {
        console.error('[settings] failed to load the update channel', error)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const changeChannel = (previous: UpdateChannel, next: UpdateChannel): void => {
    setChannel(next)
    setRejection(null)
    window.electronAPI
      .setUpdateChannel(next)
      .then((result) => {
        if (result._tag === 'Rejected') {
          setChannel(previous)
          setRejection(result.reason)
        }
      })
      .catch((error: unknown) => {
        console.error('[settings] failed to change the update channel', error)
        setChannel(previous)
        setRejection('The channel change did not save. Try again.')
      })
  }

  return (
    <>
      <SettingsRow
        id="settings-updates-channel"
        title="Update channel"
        description="Which releases Rebase follows: tested stable releases, or a fresh build of main every night."
        status={rejection ? <p className="text-destructive">{rejection}</p> : null}
      >
        <select
          aria-label="Update channel"
          value={channel ?? 'stable'}
          disabled={
            channel === null ||
            (props.updater !== null && !props.updater.supported) ||
            actionInProgress(props.updater)
          }
          onChange={(event) => {
            const selected = CHANNEL_OPTIONS.find((option) => option.value === event.target.value)
            if (channel !== null && selected && selected.value !== channel) {
              changeChannel(channel, selected.value)
            }
          }}
          className="h-[30px] rounded-md border border-input bg-input/30 px-2 text-[12.5px] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {CHANNEL_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </SettingsRow>
      {channel === 'nightly' ? <NightlyWarning /> : null}
    </>
  )
}

function UpdatePreferenceRows(props: { readOnly: boolean }) {
  const [preferences, setPreferences] = useState<UpdatePreferences | null>(null)

  useEffect(() => {
    let cancelled = false
    window.electronAPI
      .getUpdatePreferences()
      .then((stored) => {
        if (!cancelled) {
          setPreferences(stored)
        }
      })
      .catch((error: unknown) => {
        console.error('[settings] failed to load the update preferences', error)
        if (!cancelled) {
          setPreferences({ downloadInBackground: true, installOnQuit: true })
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  const save = (next: UpdatePreferences): void => {
    const previous = preferences
    setPreferences(next)
    window.electronAPI.setUpdatePreferences(next).catch((error: unknown) => {
      console.error('[settings] failed to save the update preferences', error)
      setPreferences(previous)
    })
  }

  const disabled = props.readOnly || preferences === null

  return (
    <>
      <SettingsRow
        id="settings-updates-background-download"
        title="Download updates in the background"
        description="New versions download as soon as Rebase finds them. When off, you press Download yourself."
      >
        <Checkbox
          checked={preferences?.downloadInBackground ?? true}
          disabled={disabled}
          aria-label="Download updates in the background"
          onChange={(event) => {
            if (preferences) {
              save({ ...preferences, downloadInBackground: event.target.checked })
            }
          }}
        />
      </SettingsRow>
      <SettingsRow
        id="settings-updates-install-on-quit"
        title="Install when I quit"
        description="A downloaded update installs itself the next time Rebase closes."
      >
        <Checkbox
          checked={preferences?.installOnQuit ?? true}
          disabled={disabled}
          aria-label="Install when I quit"
          onChange={(event) => {
            if (preferences) {
              save({ ...preferences, installOnQuit: event.target.checked })
            }
          }}
        />
      </SettingsRow>
    </>
  )
}

export function UpdatesContent() {
  const updater = useUpdaterState()

  return (
    <SettingsSection
      icon={DownloadIcon}
      title="Updates"
      description="How Rebase gets new versions."
    >
      <VersionRow updater={updater} />
      <UpdateChannelRow updater={updater} />
      <UpdatePreferenceRows readOnly={updater !== null && !updater.supported} />
    </SettingsSection>
  )
}

export function UpdatesNavBadge() {
  const updater = useUpdaterState()

  if (!hasPendingUpdate(updater)) {
    return null
  }

  return (
    <span
      aria-hidden
      data-testid="updates-nav-badge"
      className="size-2 shrink-0 rounded-full bg-primary"
    />
  )
}

export const updatesSection: SettingsSectionEntry = {
  id: 'updates',
  label: 'Updates',
  icon: DownloadIcon,
  Content: UpdatesContent,
  NavBadge: UpdatesNavBadge
}
