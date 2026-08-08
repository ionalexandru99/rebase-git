import type { PullDivergedStrategy } from '@shared/schemas/ipc'
import { SlidersHorizontalIcon } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import { SettingsRow } from './SettingsRow'
import { SettingsSection } from './SettingsSection'
import type { SettingsSectionEntry } from './sections'

type PullDivergedChoice = 'ask' | 'rebase' | 'merge'

const PULL_DIVERGED_CHOICES: Array<{ value: PullDivergedChoice; label: string }> = [
  { value: 'rebase', label: 'Replay your commits on top of theirs (rebase)' },
  { value: 'merge', label: 'Keep both lines of work and add a merge commit (merge)' },
  { value: 'ask', label: 'Ask each time' }
]

const toChoice = (strategy: PullDivergedStrategy): PullDivergedChoice => strategy ?? 'ask'

const toStrategy = (choice: PullDivergedChoice): PullDivergedStrategy =>
  choice === 'ask' ? null : choice

function ReopenOnLaunchRow() {
  const [reopenOnLaunch, setReopenOnLaunch] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelled = false
    window.electronAPI
      .getReopenRepositoriesOnLaunch()
      .then((reopen) => {
        if (!cancelled) {
          setReopenOnLaunch(reopen)
        }
      })
      .catch((error: unknown) => {
        console.error('[settings] failed to load the reopen-on-launch preference', error)
        if (!cancelled) {
          setReopenOnLaunch(true)
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <SettingsRow
      id="settings-general-reopen-on-launch"
      title="Reopen repositories on launch"
      description="Pick up where you left off: the repositories that were open when Rebase closed open again. When off, Rebase starts with a single blank tab."
    >
      <Checkbox
        checked={reopenOnLaunch ?? true}
        disabled={reopenOnLaunch === null}
        aria-label="Reopen repositories on launch"
        onChange={(event) => {
          const previous = reopenOnLaunch
          const reopen = event.target.checked
          setReopenOnLaunch(reopen)
          window.electronAPI.setReopenRepositoriesOnLaunch(reopen).catch((error: unknown) => {
            console.error('[settings] failed to save the reopen-on-launch preference', error)
            setReopenOnLaunch(previous)
          })
        }}
      />
    </SettingsRow>
  )
}

function PullDivergedRow() {
  const radioGroupName = useId()
  const [choice, setChoice] = useState<PullDivergedChoice | null>(null)

  useEffect(() => {
    let cancelled = false
    window.electronAPI
      .getPullDivergedStrategy()
      .then((strategy) => {
        if (!cancelled) {
          setChoice(toChoice(strategy))
        }
      })
      .catch((error: unknown) => {
        console.error('[settings] failed to load the diverged-pull strategy', error)
        if (!cancelled) {
          setChoice('ask')
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <SettingsRow
      id="settings-general-pull-diverged"
      title="When your branch and the remote have both moved on"
      description="How a pull finishes when you and the remote each have new commits."
      variant="stacked"
    >
      <div className="grid gap-[7px]">
        {PULL_DIVERGED_CHOICES.map((option) => (
          <label
            key={option.value}
            className="flex cursor-pointer items-center gap-2 text-[13.5px] text-foreground leading-[1.35]"
          >
            <input
              type="radio"
              name={radioGroupName}
              value={option.value}
              checked={choice === option.value}
              disabled={choice === null}
              onChange={() => {
                const previous = choice
                setChoice(option.value)
                window.electronAPI
                  .setPullDivergedStrategy(toStrategy(option.value))
                  .catch((error: unknown) => {
                    console.error('[settings] failed to save the diverged-pull strategy', error)
                    setChoice(previous)
                  })
              }}
              className="size-[13px] accent-[var(--brand)]"
            />
            {option.label}
          </label>
        ))}
      </div>
    </SettingsRow>
  )
}

export function GeneralContent() {
  return (
    <SettingsSection
      icon={SlidersHorizontalIcon}
      title="General"
      description="How Rebase starts and how it pulls."
    >
      <ReopenOnLaunchRow />
      <PullDivergedRow />
    </SettingsSection>
  )
}

export const generalSection: SettingsSectionEntry = {
  id: 'general',
  label: 'General',
  icon: SlidersHorizontalIcon,
  Content: GeneralContent
}
