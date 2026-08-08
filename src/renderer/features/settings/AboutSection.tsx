import type { BuildInfo } from '@shared/schemas/ipc'
import { InfoIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { SettingsRow } from './SettingsRow'
import { SettingsSection } from './SettingsSection'
import type { SettingsSectionEntry } from './sections'

export function formatBuildLine(info: BuildInfo): string {
  const shortCommit = info.commitSha.slice(0, 7)
  return `Rebase ${info.version} (${shortCommit}) · Electron ${info.electronVersion} · ${info.platformArch}`
}

function useBuildInfo(): BuildInfo | null {
  const [buildInfo, setBuildInfo] = useState<BuildInfo | null>(null)

  useEffect(() => {
    let cancelled = false
    window.electronAPI
      .getBuildInfo()
      .then((info) => {
        if (!cancelled) {
          setBuildInfo(info)
        }
      })
      .catch((error: unknown) => {
        console.error('[settings] failed to load the build info', error)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return buildInfo
}

const COPIED_RESET_MS = 2000

function BuildRow(props: { buildInfo: BuildInfo | null }) {
  const [copied, setCopied] = useState(false)
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (resetTimer.current !== null) {
        clearTimeout(resetTimer.current)
      }
    }
  }, [])

  const line = props.buildInfo === null ? null : formatBuildLine(props.buildInfo)

  const copyLine = (value: string): void => {
    navigator.clipboard
      .writeText(value)
      .then(() => {
        setCopied(true)
        if (resetTimer.current !== null) {
          clearTimeout(resetTimer.current)
        }
        resetTimer.current = setTimeout(() => {
          setCopied(false)
        }, COPIED_RESET_MS)
      })
      .catch((error: unknown) => {
        console.error('[settings] failed to copy the build info', error)
      })
  }

  return (
    <SettingsRow
      id="settings-about-build"
      title="Build"
      description="The exact build you are running — paste this into bug reports."
      status={line === null ? null : <p className="font-mono">{line}</p>}
    >
      {line === null ? null : (
        <Button
          type="button"
          size="sm"
          className="h-[30px] px-2.5 text-[12.5px]"
          variant="outline"
          onClick={() => {
            copyLine(line)
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </Button>
      )}
    </SettingsRow>
  )
}

function LogsRow() {
  return (
    <SettingsRow
      id="settings-about-logs"
      title="Logs"
      description="Open the folder where Rebase writes its log files."
    >
      <Button
        type="button"
        size="sm"
        className="h-[30px] px-2.5 text-[12.5px]"
        variant="outline"
        onClick={() => {
          window.electronAPI.revealLogsFolder().catch((error: unknown) => {
            console.error('[settings] failed to reveal the logs folder', error)
          })
        }}
      >
        Show logs folder
      </Button>
    </SettingsRow>
  )
}

function ReleaseNotesRow() {
  return (
    <SettingsRow
      id="settings-about-release-notes"
      title="Release notes"
      description="What changed in this version, on the GitHub releases page."
    >
      <Button
        type="button"
        size="sm"
        className="h-[30px] px-2.5 text-[12.5px]"
        variant="outline"
        onClick={() => {
          window.electronAPI.openReleaseNotes().catch((error: unknown) => {
            console.error('[settings] failed to open the release notes', error)
          })
        }}
      >
        Open release notes
      </Button>
    </SettingsRow>
  )
}

export function AboutContent() {
  const buildInfo = useBuildInfo()

  return (
    <SettingsSection icon={InfoIcon} title="About" description="The build you are running.">
      <BuildRow buildInfo={buildInfo} />
      <LogsRow />
      <ReleaseNotesRow />
    </SettingsSection>
  )
}

export const aboutSection: SettingsSectionEntry = {
  id: 'about',
  label: 'About',
  icon: InfoIcon,
  Content: AboutContent
}
