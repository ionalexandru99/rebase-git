import type { UpdatePreferences, UpdaterActionResult, UpdaterState } from '@shared/schemas/ipc'
import { DownloadIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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

function useUpdaterState(): UpdaterState | null {
  const [updater, setUpdater] = useState<UpdaterState | null>(null)

  useEffect(() => {
    let cancelled = false
    window.electronAPI
      .getUpdaterState()
      .then((state) => {
        if (!cancelled) {
          setUpdater(state)
        }
      })
      .catch((error: unknown) => {
        console.error('[settings] failed to load the update state', error)
      })
    const unsubscribe = window.electronAPI.onUpdaterStateChanged((state) => {
      setUpdater(state)
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  return updater
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
    setPreferences(next)
    window.electronAPI.setUpdatePreferences(next).catch((error: unknown) => {
      console.error('[settings] failed to save the update preferences', error)
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
      <UpdatePreferenceRows readOnly={updater !== null && !updater.supported} />
    </SettingsSection>
  )
}

export const updatesSection: SettingsSectionEntry = {
  id: 'updates',
  label: 'Updates',
  icon: DownloadIcon,
  Content: UpdatesContent
}
